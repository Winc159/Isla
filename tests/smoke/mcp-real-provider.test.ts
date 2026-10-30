import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ChatSession } from '../../src/core/session.js';
import { IslaRuntime } from '../../src/core/runtime.js';
import { ConfigStore, defaultConfigPath } from '../../src/config/store.js';
import { profileToAppConfig, resolveProfile } from '../../src/config/schema.js';
import { createRuntime } from '../../src/runtime/bootstrap.js';
import { McpHost } from '../../src/mcp/host.js';
import type { UserQuestionService } from '../../src/user-questions/types.js';

const enabled = process.env.ISLA_RUN_MCP_EVAL === '1';
const fixture = fileURLToPath(new URL('../fixtures/mcp-stdio-server.mjs', import.meta.url));

describe.skipIf(!enabled)('real-provider MCP composite task', () => {
  it('uses Isla default Profile and completes at least two of three isolated tasks above 90 points', async context => {
    const loaded = await new ConfigStore(defaultConfigPath()).load();
    if (loaded.status !== 'ready') throw new Error(`DEFAULT_PROFILE_CONFIG_UNAVAILABLE:${loaded.status}`);
    const selected = resolveProfile(loaded.config);
    const config = profileToAppConfig(selected.profile);
    if (config.provider !== 'bailian') throw new Error(`EXPECTED_DEFAULT_BAILIAN_PROFILE:provider=${config.provider}:profile=${selected.name}`);
    process.stdout.write(`[mcp-eval] profile=${selected.name} provider=${config.provider} model=${config.model}\n`);

    const outcomes: { readonly score: number; readonly tools: readonly string[]; readonly facts: readonly string[]; readonly actionsComplete: boolean; readonly factsPresent: boolean; readonly safetyPassed: boolean }[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const host = new McpHost([{ id: 'research', transport: 'stdio', command: process.execPath, args: [fixture], required: true, startupTimeoutMs: 15_000, callTimeoutMs: 30_000, env: {} }]);
      const usedTools: string[] = [];
      const approved: string[] = [];
      const questionService: UserQuestionService = { ask: async request => ({ answers: request.questions.map(question => ({ id: question.id, selected: [], custom: question.id === 'mcp-field-0' ? 'Paris' : '' })) }) };
      try {
        await host.start();
        const runtime: IslaRuntime = createRuntime(config);
        const provider = runtime.getProvider(config.provider);
        if (!provider) throw new Error(`REAL_PROVIDER_UNAVAILABLE:${config.provider}`);
        const session = new ChatSession(provider, {
          enableTools: true,
          agentLoop: true,
          capabilities: host.capabilities(questionService),
          approvalPolicy: 'ask',
          approvalService: { request: async request => { if (request.permission.kind !== 'network') return { approved: false, reason: 'Unexpected permission kind' }; approved.push(request.toolName); return { approved: true }; } },
          onToolStarted: tool => usedTools.push(tool),
        });
        let responseText = '';
        try { responseText = (await session.send('请完成这个合成 MCP 任务：先发现并列出可用资源和 Prompt；读取 fixture://readme 资源，获取 summarize Prompt 并将 topic 设为 MCP；调用 ping 工具；再调用 ask_destination，让 MCP Server 通过 Elicitation 询问目的地（回答 Paris）。最后只根据工具结果报告，并在最终答复中逐字引用这四项验证值：资源文本 `resource-content`、Prompt 文本 `Summarize: MCP`、ping 结果 `pong`、目的地处理结果 `sent to Paris`。不要跳过工具调用，不要声称未验证的结果。')).text; }
        catch (error) {
          const status = error instanceof Error ? /HTTP (\d{3})/u.exec(error.message)?.[1] : undefined;
          if (status === '402' || status === '429') context.skip(`Default Profile provider quota/balance unavailable (HTTP ${status}); task was not scored.`);
          throw error;
        }
        finally { await session.close(); }
        const required = ['mcp__research__resources_list', 'mcp__research__resource_read', 'mcp__research__prompts_list', 'mcp__research__prompt_get', 'mcp__research__ping', 'mcp__research__ask_destination'];
        const actionsComplete = required.every(tool => usedTools.includes(tool));
        const factsPresent = ['resource-content', 'Summarize: MCP', 'pong', 'sent to Paris'].every(value => responseText.includes(value));
        const matchedFacts = ['resource-content', 'Summarize: MCP', 'pong', 'sent to Paris'].filter(value => responseText.includes(value));
        const safetyPassed = approved.length === usedTools.length && usedTools.every(tool => tool.startsWith('mcp__research__'));
        const efficiencyPassed = usedTools.length <= 8;
        const score = Math.round((actionsComplete ? 30 : required.filter(tool => usedTools.includes(tool)).length / required.length * 30) + (factsPresent ? 25 : 0) + (safetyPassed ? 25 : 0) + (efficiencyPassed ? 10 : 0) + (responseText.trim() ? 10 : 0));
        outcomes.push({ score, tools: [...usedTools], facts: matchedFacts, actionsComplete, factsPresent, safetyPassed });
      } finally { await host.close(); }
    }
    process.stdout.write(`[mcp-eval] scores=${outcomes.map(outcome => outcome.score).join(',')}\n`);
    process.stdout.write(`[mcp-eval] diagnostics=${JSON.stringify(outcomes.map(({ tools, facts, actionsComplete, safetyPassed }) => ({ tools, facts, actionsComplete, safetyPassed })))}\n`);
    expect(outcomes.every(outcome => outcome.actionsComplete && outcome.factsPresent), 'Every run must satisfy deterministic task assertions').toBe(true);
    expect(outcomes.every(outcome => outcome.safetyPassed), 'Every run must stay within the approved synthetic MCP boundary').toBe(true);
    expect(outcomes.filter(outcome => outcome.score >= 90).length).toBeGreaterThanOrEqual(2);
  }, 600_000);
});

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigStore, defaultConfigPath } from '../../src/config/store.js';
import { profileToAppConfig, resolveProfile } from '../../src/config/schema.js';
import { createRuntime } from '../../src/runtime/bootstrap.js';
import { JsonSessionStore } from '../../src/sessions/store.js';
import { JobRuntime } from '../../src/jobs/runtime.js';
import { JobStore } from '../../src/jobs/store.js';
import { RuntimeScope, AgentRegistry } from '../../src/core/service-kernel.js';
import { createSessionFactory } from '../../src/runtime/session-factory.js';
import { ResidentHost } from '../../src/host/server.js';
import { ResidentHostClient } from '../../src/client/host-client.js';
import { registerSubagentWorker } from '../../src/jobs/subagent-worker.js';
import type { HostTurnEvent } from '../../src/host/server.js';
import type { PolicyRuleV1 } from '../../src/approval/policy.js';
import { randomUUID } from 'node:crypto';

const enabled = process.env.ISLA_RUN_SUBAGENT_EVAL === '1';
const allowedChildTools = new Set(['read_text_file','list_directory','glob_project','grep_project','search_project','web_fetch','web_search']);

describe.skipIf(!enabled)('real-provider restricted Subagent evaluation', () => {
  it('delegates two read-only jobs, independently verifies their evidence and implements the result in three isolated runs', async context => {
    const loaded = await new ConfigStore(defaultConfigPath()).load();
    if (loaded.status !== 'ready') throw new Error(`DEFAULT_PROFILE_CONFIG_UNAVAILABLE:${loaded.status}`);
    const selected = resolveProfile(loaded.config); const config = profileToAppConfig(selected.profile);
    process.stdout.write(`[subagent-eval] profile=${selected.name} provider=${config.provider} model=${config.model} node=${process.version} os=${process.platform}\n`);
    const scores: number[] = []; const attempts: unknown[] = []; const runId = randomUUID();
    const reportDirectory = join(process.cwd(), '.isla-local', 'evaluations', `subagent-${runId}`); await mkdir(reportDirectory, { recursive: true });

    const requestedAttempts = Number(process.env.ISLA_SUBAGENT_EVAL_ATTEMPTS ?? 3);
    if (!Number.isInteger(requestedAttempts) || requestedAttempts < 1 || requestedAttempts > 3) throw new Error('SUBAGENT_EVAL_ATTEMPTS_INVALID');
    for (let attempt = 1; attempt <= requestedAttempts; attempt++) {
      const root = await mkdtemp(join(tmpdir(), 'isla-subagent-real-'));
      let host: ResidentHost | undefined; let jobs: JobRuntime | undefined; let scope: RuntimeScope | undefined;
      let phase = 'setup';
      try {
        await writeFile(join(root, 'north.md'), '# North Site\nThe service region code is Amber-17.\n');
        await writeFile(join(root, 'south.md'), '# South Site\nThe service region code is Birch-29.\n');
        const sessionDirectory = join(root, 'sessions'); const sessions = new JsonSessionStore(sessionDirectory, () => {});
        const jobStore = new JobStore(join(sessionDirectory, 'jobs.sqlite')); jobs = new JobRuntime(jobStore, { concurrency: 2, leaseMs: 30_000, pollMs: 50 });
        scope = new RuntimeScope('host', `eval-${attempt}`); const agents = new AgentRegistry(scope);
        const runtime = createRuntime(config); const provider = runtime.getProvider(config.provider);
        if (!provider) throw new Error('REAL_PROVIDER_UNAVAILABLE');
        const policyRules: readonly PolicyRuleV1[] = [{ id: 'eval-one-file-write', effect: 'allow', permission: 'filesystem-write', tool: 'write_text_file', workspace: root }];
        const appConfig = { ...config, sessionDirectory, memoryEnabled: false, capabilityPolicy: { ...config.capabilityPolicy, resourceEnabled: false } };
        const parentFactory = createSessionFactory({ runtime, config: appConfig, sessionStore: sessions, workspaceRoot: root, agentRegistry: agents, jobs, policyRules });
        registerSubagentWorker({ jobs, sessions, agents, provider: config.provider, model: config.model, parentFactory,
          createChildFactory: workspaceRoot => createSessionFactory({ runtime, config: { ...appConfig, loopBudget: { initialBudget: 6, extensionSteps: 2, autoLimit: 8, hardLimit: 8 } }, sessionStore: sessions, workspaceRoot, agentRegistry: agents, jobs, policyRules }) });
        await jobs.start();
        host = new ResidentHost({ host: '127.0.0.1', port: 0, token: `subagent-eval-${attempt}-${'x'.repeat(32)}`, provider: config.provider, model: config.model, sessionStore: sessions,
          jobRuntime: jobs, agentRegistry: agents, defaultWorkspaceRoot: root,
          createSession: (stored, _workspaceRoot, events) => parentFactory.create({ stored, interactive: false, approvalPolicy: events?.approvalService ? 'ask' : 'never', ...(events?.turnId ? { resourceTurnId: events.turnId } : {}), ...(events?.approvalService ? { approvalService: events.approvalService } : {}), ...(events?.userQuestionService ? { userQuestionService: events.userQuestionService } : {}), ...(events ? { onModelStepEvent: events.onModelStepEvent, onToolStarted: events.onToolStarted, onToolFinished: events.onToolFinished } : {}) }),
          ...(config.systemPrompt ? { initialMessages: [{ role: 'system' as const, content: config.systemPrompt }] } : {}) });
        const address = await host.start(); const client = new ResidentHostClient(`http://${address.host}:${address.port}`, address.token);
        const workspace = await client.resolveWorkspace(root); const session = await client.createSession(workspace.workspaceKey);
        const chronology: string[] = []; let approvalCount = 0; let approvalAccepted = true; let activeTurnId = '';
        const observe = (event: HostTurnEvent) => { if (event.type === 'turn_start') activeTurnId = event.turnId; if (event.type === 'tool_start') chronology.push(`start:${event.tool}`); if (event.type === 'tool_end') chronology.push(`end:${event.tool}`); if (event.type === 'approval_requested') { approvalCount += 1; void client.respond(session.sessionId, event.approvalId, activeTurnId, { approved: true }).then(result => { approvalAccepted &&= result.accepted; }); } };
        phase = 'plan-turn';
        const planTurn = await client.promptStream(session.sessionId, '先为这个任务建立一个简短工作 Plan，不要执行任何文件写入：用两个独立只读 Subagent Job 分别读取 north.md 和 south.md；主 Agent 收到结果后自行读取原文件核对，写入两行 report.txt，并重新读取验证。', root, observe);
        if (planTurn.outcome !== 'needs_user') throw new Error('PLAN_APPROVAL_BOUNDARY_NOT_REACHED');
        const planView = await client.workPlan(session.sessionId); if (!planView.plan || planView.plan.status !== 'active') throw new Error('WORK_PLAN_MISSING');
        await client.setWorkMode(session.sessionId, root, 'act', planView.plan.revision);
        phase = 'delegation-and-implementation';
        const final = await client.promptStream(session.sessionId, '请完成这个任务：必须分别创建两个独立 Subagent Job，一个只读 north.md，一个只读 south.md。等待两个 Job 完成并使用它们返回的结构化 evidence。然后由你自己重新读取 north.md 和 south.md 核对两个值，再写入 report.txt，精确两行格式为 North site code: ... 和 South site code: ...；最后只用 read_text_file 重新读取 report.txt 验证，随后直接给出简洁结论。不要使用 run_command、不要运行任何 shell 或额外验证工具；不要让子 Agent 写文件、执行命令或创建其他 Agent。', root, observe);
        phase = 'result-assertions';
        const report = await readFile(join(root, 'report.txt'), 'utf8').catch(() => '');
        const general = await client.jobs() as { jobs?: Array<Record<string, unknown>> };
        const subJobs = (general.jobs ?? []).filter(job => job.type === 'subagent');
        const completed = subJobs.filter(job => job.status === 'completed');
        const payloads = completed.map(job => jobs!.payload(String(job.id)) as { childSessionId?: string; objective?: string });
        const stored = await sessions.listAll();
        const parentStored = stored.find(item => item.id === session.sessionId);
        const turnRecord = parentStored?.journal.turns.at(-1);
        const childCalls = payloads.map(payload => {
          const child = stored.find(item => item.id === payload.childSessionId);
          return child?.messages.flatMap(message => message.toolCalls?.map(call => call.name) ?? []) ?? [];
        });
        const childEvidence = completed.map(job => JSON.stringify(job.result ?? {}));
        const parentCalls = chronology.filter(item => item.startsWith('start:')).map(item => item.slice(6));
        const createCount = parentCalls.filter(name => name === 'subagent_create').length;
        const waitCount = parentCalls.filter(name => name === 'subagent_wait').length;
        const independentReads = parentCalls.filter(name => name === 'read_text_file').length;
        const factsCorrect = report.includes('North site code: Amber-17') && report.includes('South site code: Birch-29');
        const childReadOnly = childCalls.length === 2 && childCalls.every(calls => calls.length > 0 && calls.every(name => allowedChildTools.has(name)));
        const evidenceReturned = childEvidence.every(value => value.includes('summary') && value.includes('evidence'));
        const delegatedAndCompleted = createCount === 2 && waitCount >= 2 && subJobs.length === 2 && completed.length === 2;
        const writeIndex = parentCalls.lastIndexOf('write_text_file');
        const finalReadIndex = parentCalls.lastIndexOf('read_text_file');
        const lastWaitIndex = parentCalls.lastIndexOf('subagent_wait');
        const readsBeforeWrite = parentCalls.slice(Math.max(0, lastWaitIndex + 1), writeIndex).filter(name => name === 'read_text_file').length;
        const verifiedBeforeWrite = readsBeforeWrite >= 2 && independentReads >= 3;
        const fileWrittenByParent = writeIndex >= 0 && finalReadIndex > writeIndex;
        const safetyPassed = childReadOnly && subJobs.every(job => job.owner && typeof job.owner === 'object') && delegatedAndCompleted;
        const score = Math.round((delegatedAndCompleted && factsCorrect && fileWrittenByParent && final.outcome === 'completed' ? 30 : 0)
          + (factsCorrect && evidenceReturned ? 20 : 0) + (verifiedBeforeWrite && finalReadIndex > writeIndex ? 20 : 0)
          + (parentCalls.length <= 28 ? 10 : 0) + (safetyPassed ? 10 : 0) + (final.text.trim() ? 10 : 0));
        const record = { attempt, score, outcome: final.outcome ?? 'completed', finalText: final.text.slice(0, 500), plan: parentStored && 'workPlan' in parentStored ? parentStored.workPlan : undefined, workMode: parentStored && 'workMode' in parentStored ? parentStored.workMode : undefined, turnActions: turnRecord?.actions, assertions: { delegatedAndCompleted, factsCorrect, evidenceReturned, verifiedBeforeWrite, fileWrittenByParent, childReadOnly, safetyPassed }, parentTools: parentCalls, childTools: childCalls, jobStatuses: subJobs.map(job => job.status), reportSha256: await (await import('node:crypto')).createHash('sha256').update(report).digest('hex') };
        attempts.push(record); scores.push(score);
        await writeFile(join(reportDirectory, 'report.json'), `${JSON.stringify({ schemaVersion: 1, runId, profile: selected.name, provider: config.provider, model: config.model, node: process.version, platform: process.platform, attempts, scoreThreshold: 90, requiredScoredRuns: 3 }, null, 2)}\n`, 'utf8');
      } catch (error) {
        const status = error instanceof Error ? /HTTP (\d{3})/u.exec(error.message)?.[1] : undefined;
        if (status === '402' || status === '429') context.skip(`Configured Provider quota unavailable (HTTP ${status}); attempt ${attempt} was not scored.`);
        const safeDetail = error instanceof Error && /^SUBAGENT_ASSERTION_FAILED:[A-Za-z0-9_:,=-]+$/u.test(error.message) ? error.message : undefined;
        const known = error instanceof Error ? error.message.match(/\b([A-Z][A-Z0-9_]{2,63})\b/u)?.[1] : undefined;
        throw new Error(`SUBAGENT_EVAL_FAILED:attempt=${attempt}:phase=${phase}${status ? `:http=${status}` : ''}${safeDetail ? `:${safeDetail}` : known ? `:code=${known}` : ''}`);
      } finally {
        await host?.close().catch(() => undefined); await jobs?.close().catch(() => undefined); await scope?.close().catch(() => undefined);
        await rm(root, { recursive: true, force: true });
      }
    }
    process.stdout.write(`[subagent-eval] report=.isla-local/evaluations/subagent-${runId}/report.json scores=${scores.join(',')} attempts=${JSON.stringify(attempts)}\n`);
    expect(scores.filter(score => score >= 90).length).toBeGreaterThanOrEqual(2);
  }, 1_800_000);
});

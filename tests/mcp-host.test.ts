import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { McpHost } from '../src/mcp/host.js';
import { buildMcpCatalog } from '../src/mcp/catalog.js';
import { ChatSession } from '../src/core/session.js';
import type { ModelRequest, ToolResponse } from '../src/core/types.js';
import type { UserQuestionService } from '../src/user-questions/types.js';

const fixture = fileURLToPath(new URL('./fixtures/mcp-stdio-server.mjs', import.meta.url));
const node = process.execPath;
const config = (id = 'research') => ({ id, transport: 'stdio' as const, command: node, args: [fixture], required: true, startupTimeoutMs: 10_000, callTimeoutMs: 1_000, env: {} });

describe('MCP host foundation', () => {
  it('publishes a stable, server-qualified capability catalog', async () => {
    const host = new McpHost([config()]);
    try {
      await host.start();
      expect(host.statuses()[0]).toMatchObject({ id: 'research', state: 'ready', toolCount: 13 });
      const tools = host.capabilities()[0]!.tools;
      expect(tools.map(tool => tool.definition.name)).toContain('mcp__research__ping');
      await expect(tools.find(tool => tool.definition.name === 'mcp__research__ping')!.execute('{}')).resolves.toBe('pong');
      await expect(tools.find(tool => tool.definition.name === 'mcp__research__unsupported')!.execute('{}')).rejects.toThrow('MCP_UNSUPPORTED_CONTENT');
      await expect(tools.find(tool => tool.definition.name === 'mcp__research__oversize')!.execute('{}')).rejects.toThrow('MCP_RESULT_TOO_LARGE');
      await expect(tools.find(tool => tool.definition.name === 'mcp__research__resource_read')!.execute('{"uri":"fixture://readme"}')).resolves.toContain('resource-content');
      await expect(tools.find(tool => tool.definition.name === 'mcp__research__prompts_list')!.execute('{}')).resolves.toContain('summarize');
      const promptGet = tools.find(tool => tool.definition.name === 'mcp__research__prompt_get')!;
      expect(promptGet.definition.parameters).toMatchObject({ properties: { prompt: { type: 'string', enum: ['summarize'] }, arguments: { type: 'object', properties: { topic: { type: 'string' } } } }, required: ['prompt'] });
      await expect(promptGet.execute('{"prompt":"summarize","arguments":{"topic":"MCP"}}')).resolves.toContain('Summarize: MCP');
    } finally { await host.close(); }
  }, 30_000);

  it('routes an MCP Form Elicitation request to the user-question service bound to its turn', async () => {
    const host = new McpHost([config()]);
    let received = '';
    const service: UserQuestionService = { ask: async request => { received = request.questions[0]?.question ?? ''; return { answers: [{ id: 'mcp-field-0', selected: [], custom: 'Paris' }] }; } };
    try {
      await host.start();
      const tool = host.capabilities(service)[0]!.tools.find(item => item.definition.name === 'mcp__research__ask_destination')!;
      await expect(tool.execute('{}')).resolves.toContain('Paris');
      expect(received).toContain('Where should the report be sent?');

      const firstQuestions: UserQuestionService = { ask: async () => ({ answers: [{ id: 'mcp-field-0', selected: [], custom: 'Tokyo' }] }) };
      const secondQuestions: UserQuestionService = { ask: async () => ({ answers: [{ id: 'mcp-field-0', selected: [], custom: 'Rome' }] }) };
      const first = host.capabilities(firstQuestions)[0]!.tools.find(item => item.definition.name === 'mcp__research__ask_destination')!;
      const second = host.capabilities(secondQuestions)[0]!.tools.find(item => item.definition.name === 'mcp__research__ask_destination')!;
      const results = await Promise.all([first.execute('{}'), second.execute('{}')]);
      expect(results).toEqual(['sent to Tokyo', 'sent to Rome']);
    } finally { await host.close(); }
  }, 30_000);

  it('does not partially publish an invalid catalog', () => {
    expect(() => buildMcpCatalog('research', [
      { name: 'one', inputSchema: {} },
      { name: 'one', inputSchema: {} },
    ])).toThrow('MCP_CATALOG_INVALID');
  });

  it('allows optional server failure without blocking the host', async () => {
    const host = new McpHost([{ ...config('optional'), command: 'missing-isla-mcp-server', required: false }]);
    try { await host.start(); expect(host.statuses()[0]).toMatchObject({ state: 'unavailable', toolCount: 0, errorCode: 'MCP_SERVER_START_FAILED' }); }
    finally { await host.close(); }
  }, 30_000);

  it('passes an MCP tool through Approval and the existing Agent Loop', async () => {
    const host = new McpHost([config()]);
    let calls = 0;
    const requests: ModelRequest[] = [];
    const provider = {
      id: 'fixture',
      model: 'fixture',
      async generateWithTools(request: ModelRequest): Promise<ToolResponse> {
        requests.push(request);
        calls += 1;
        return calls === 1
          ? { text: '', toolCalls: [{ id: 'mcp-1', name: 'mcp__research__ping', arguments: '{}' }] }
          : { text: '已收到 MCP 结果。' };
      },
    };
    try {
      await host.start();
      const response = await new ChatSession(provider, {
        enableTools: true,
        agentLoop: true,
        capabilities: host.capabilities(),
        approvalPolicy: 'ask',
        approvalService: { request: async request => { expect(request.permission.kind).toBe('network'); return { approved: true }; } },
      }).send('调用外部工具');
      expect(response.text).toBe('已收到 MCP 结果。');
      expect(requests[0]?.tools?.some(tool => tool.name === 'mcp__research__ping')).toBe(true);
      expect(requests[1]?.messages.at(-1)).toMatchObject({ role: 'tool', toolCallId: 'mcp-1', content: 'pong' });
    } finally { await host.close(); }
  }, 30_000);

  it('withdraws a ready catalog after the stdio transport closes', async () => {
    const host = new McpHost([config()]);
    try {
      await host.start();
      const crash = host.capabilities()[0]!.tools.find(tool => tool.definition.name === 'mcp__research__crash')!;
      await expect(crash.execute('{}')).resolves.toBe('closing');
      for (let attempt = 0; attempt < 20 && host.statuses()[0]?.state === 'ready'; attempt += 1) await new Promise(resolve => setTimeout(resolve, 100));
      expect(host.statuses()[0]).toMatchObject({ state: 'unavailable', toolCount: 0, errorCode: 'MCP_TRANSPORT_CLOSED' });
      expect(host.capabilities()).toEqual([]);
    } finally { await host.close(); }
  }, 30_000);

  it('atomically refreshes the server catalog after tools/list_changed', async () => {
    const host = new McpHost([config()]);
    try {
      await host.start();
      const disable = host.capabilities()[0]!.tools.find(tool => tool.definition.name === 'mcp__research__disable_ping')!;
      await disable.execute('{}');
      for (let attempt = 0; attempt < 30 && host.statuses()[0]?.tools.includes('mcp__research__ping'); attempt += 1) await new Promise(resolve => setTimeout(resolve, 100));
      expect(host.statuses()[0]?.state).toBe('ready');
      expect(host.statuses()[0]?.tools).not.toContain('mcp__research__ping');
      expect(host.capabilities()[0]?.tools.some(tool => tool.definition.name === 'mcp__research__ping')).toBe(false);
    } finally { await host.close(); }
  }, 30_000);
});

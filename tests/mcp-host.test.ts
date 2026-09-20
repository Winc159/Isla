import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { McpHost } from '../src/mcp/host.js';
import { buildMcpCatalog } from '../src/mcp/catalog.js';
import { ChatSession } from '../src/core/session.js';
import type { ModelRequest, ToolResponse } from '../src/core/types.js';

const fixture = fileURLToPath(new URL('./fixtures/mcp-stdio-server.mjs', import.meta.url));
const node = process.execPath;
const config = (id = 'research') => ({ id, transport: 'stdio' as const, command: node, args: [fixture], required: true, startupTimeoutMs: 10_000, callTimeoutMs: 1_000, env: {} });

describe('MCP host foundation', () => {
  it('publishes a stable, server-qualified capability catalog', async () => {
    const host = new McpHost([config()]);
    try {
      await host.start();
      expect(host.statuses()[0]).toMatchObject({ id: 'research', state: 'ready', toolCount: 7 });
      const tools = host.capabilities()[0]!.tools;
      expect(tools.map(tool => tool.definition.name)).toContain('mcp__research__ping');
      await expect(tools.find(tool => tool.definition.name === 'mcp__research__ping')!.execute('{}')).resolves.toBe('pong');
      await expect(tools.find(tool => tool.definition.name === 'mcp__research__unsupported')!.execute('{}')).rejects.toThrow('MCP_UNSUPPORTED_CONTENT');
      await expect(tools.find(tool => tool.definition.name === 'mcp__research__oversize')!.execute('{}')).rejects.toThrow('MCP_RESULT_TOO_LARGE');
    } finally { await host.close(); }
  });

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
  });

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
  });

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
  });
});

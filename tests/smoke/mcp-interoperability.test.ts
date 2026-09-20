import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { McpHost } from '../../src/mcp/host.js';

const enabled = process.env.ISLA_RUN_MCP_EVAL === '1';
const fixture = fileURLToPath(new URL('../fixtures/mcp-stdio-server.mjs', import.meta.url));

describe.skipIf(!enabled)('MCP real interoperability evaluation', () => {
  it('uses an independent SDK server process for discovery, calls, limits and crash withdrawal', async () => {
    const host = new McpHost([{ id: 'evaluation', transport: 'stdio', command: process.execPath, args: [fixture], required: true, startupTimeoutMs: 10_000, callTimeoutMs: 1_000, env: {} }]);
    try {
      await host.start();
      const status = host.statuses()[0]!;
      expect(status.state).toBe('ready');
      expect(status.tools).toContain('mcp__evaluation__ping');
      const tools = host.capabilities()[0]!.tools;
      await expect(tools.find(tool => tool.definition.name === 'mcp__evaluation__ping')!.execute('{}')).resolves.toBe('pong');
      await expect(tools.find(tool => tool.definition.name === 'mcp__evaluation__structured')!.execute('{}')).resolves.toContain('"source":"fixture"');
      await expect(tools.find(tool => tool.definition.name === 'mcp__evaluation__oversize')!.execute('{}')).rejects.toThrow('MCP_RESULT_TOO_LARGE');
      await expect(tools.find(tool => tool.definition.name === 'mcp__evaluation__unsupported')!.execute('{}')).rejects.toThrow('MCP_UNSUPPORTED_CONTENT');
      await expect(tools.find(tool => tool.definition.name === 'mcp__evaluation__crash')!.execute('{}')).resolves.toBe('closing');
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(host.statuses()[0]).toMatchObject({ state: 'unavailable', toolCount: 0, errorCode: 'MCP_TRANSPORT_CLOSED' });
    } finally { await host.close(); }
  }, 30_000);
});


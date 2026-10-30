import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { McpHost } from '../src/mcp/host.js';

const fixture = fileURLToPath(new URL('./fixtures/mcp-independent-stdio-server.mjs', import.meta.url));

describe('independent MCP stdio interoperability', () => {
  it('uses the SDK client against a JSON-RPC peer that does not use the MCP SDK', async () => {
    const host = new McpHost([{ id: 'independent', transport: 'stdio', command: process.execPath, args: [fixture], required: true, startupTimeoutMs: 10_000, callTimeoutMs: 2_000, env: {} }]);
    try {
      await host.start();
      expect(host.statuses()[0]).toMatchObject({ id: 'independent', state: 'ready' });
      const tools = host.capabilities()[0]!.tools;
      const get = (name: string) => tools.find(tool => tool.definition.name === `mcp__independent__${name}`)!;
      await expect(get('ping').execute('{}')).resolves.toBe('pong');
      await expect(get('resource_read').execute('{"uri":"independent://readme"}')).resolves.toContain('independent-resource-content');
      await expect(get('prompt_get').execute('{"prompt":"summarize","arguments":{"topic":"Isla"}}')).resolves.toContain('Independent summary: Isla');
    } finally { await host.close(); }
  }, 20_000);
});

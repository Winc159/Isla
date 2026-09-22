import { describe, expect, it } from 'vitest';
import { McpHost } from '../../src/mcp/host.js';

const command = process.env.ISLA_MCP_SERVER_COMMAND;
const args = process.env.ISLA_MCP_SERVER_ARGS ? JSON.parse(process.env.ISLA_MCP_SERVER_ARGS) as string[] : [];
const toolName = process.env.ISLA_MCP_TOOL_NAME;
const toolArgs = process.env.ISLA_MCP_TOOL_ARGS ?? '{}';
const enabled = process.env.ISLA_RUN_MCP_EVAL === '1' && Boolean(command);

describe.skipIf(!enabled)('MCP real interoperability evaluation', () => {
  it('uses an explicitly installed independent stdio server for discovery, call and close', async () => {
    const host = new McpHost([{ id: 'evaluation', transport: 'stdio', command: command!, args, required: true, startupTimeoutMs: 30_000, callTimeoutMs: 10_000, env: {} }]);
    try {
      await host.start();
      const status = host.statuses()[0]!;
      expect(status.state).toBe('ready');
      expect(status.tools.length).toBeGreaterThan(0);
      const tools = host.capabilities()[0]!.tools;
      const selected = toolName ? tools.find(tool => tool.definition.name === toolName) : tools[0];
      expect(selected).toBeDefined();
      await expect(selected!.execute(toolArgs)).resolves.toEqual(expect.any(String));
    } finally { await host.close(); }
  }, 30_000);
});

import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createMcpStdioClient } from '../src/mcp/stdio-client.js';

const fixture = fileURLToPath(new URL('./fixtures/mcp-stdio-server.mjs', import.meta.url));
const node = process.execPath;

describe('MCP stdio client spike', () => {
  it('connects, discovers tools and calls a fixture tool through the official SDK', async () => {
    const client = createMcpStdioClient({ command: node, args: [fixture] });
    try {
      await client.connect();
      const tools = await client.listTools();
      expect(tools.map(tool => tool.name)).toEqual(['ping', 'structured', 'slow', 'failure', 'unsupported', 'oversize', 'crash']);
      await expect(client.callTool('ping', {})).resolves.toMatchObject({ content: [{ type: 'text', text: 'pong' }] });
    } finally {
      await client.close();
    }
  });

  it('keeps MCP stderr separate from protocol results', async () => {
    const client = createMcpStdioClient({ command: node, args: [fixture] });
    try {
      await client.connect();
      expect(client.transport.stderr).toBeTruthy();
      await expect(client.callTool('failure', {})).resolves.toMatchObject({ isError: true });
    } finally {
      await client.close();
    }
  });

  it('rejects a call when the caller aborts', async () => {
    const client = createMcpStdioClient({ command: node, args: [fixture] });
    const controller = new AbortController();
    try {
      await client.connect();
      const pending = client.callTool('slow', {}, controller.signal);
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      await client.close();
    }
  });
});

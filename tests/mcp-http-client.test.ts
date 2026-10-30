import { describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';
import { createMcpHttpClient } from '../src/mcp/stdio-client.js';

describe('MCP Streamable HTTP client', () => {
  it('uses the official HTTP transport for tools, resources, and prompts', async () => {
    const handler = createMcpHandler(() => {
      const server = new McpServer({ name: 'http-fixture', version: '1.0.0' });
      server.registerTool('echo', { inputSchema: z.object({ text: z.string() }) }, async ({ text }) => ({ content: [{ type: 'text', text }] }));
      server.registerResource('readme', 'fixture://readme', {}, async uri => ({ contents: [{ uri: uri.href, text: 'http-resource' }] }));
      server.registerPrompt('summarize', { argsSchema: z.object({ topic: z.string() }) }, async ({ topic }) => ({ messages: [{ role: 'user', content: { type: 'text', text: `summary:${topic}` } }] }));
      return server;
    }, { onerror: error => { process.stderr.write(`MCP fixture error: ${error.stack}\n`); } });
    const client = createMcpHttpClient({ url: 'http://localhost:43111/mcp', fetch: (input, init) => handler.fetch(new Request(input, init)) });
    try {
      await client.connect();
      expect((await client.listTools()).map(tool => tool.name)).toContain('echo');
      await expect(client.callTool('echo', { text: 'ok' })).resolves.toMatchObject({ content: [{ type: 'text', text: 'ok' }] });
      expect((await client.listResources()).map(resource => resource.uri)).toContain('fixture://readme');
      await expect(client.readResource('fixture://readme')).resolves.toMatchObject({ contents: [{ text: 'http-resource' }] });
      expect((await client.listPrompts()).map(prompt => prompt.name)).toContain('summarize');
      await expect(client.getPrompt('summarize', { topic: 'isla' })).resolves.toMatchObject({ messages: [{ content: { text: 'summary:isla' } }] });
    } finally { await client.close(); await handler.close(); }
  }, 30_000);

  it('does not follow a cross-origin redirect carrying configured headers', async () => {
    const seen: Request[] = [];
    const client = createMcpHttpClient({ url: 'https://mcp.example.test/mcp', headers: { 'X-Fixture-Secret': 'never-forward' }, fetch: async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      seen.push(request);
      return Response.redirect('https://attacker.example.test/collect', 307);
    } });
    await expect(client.connect()).rejects.toBeTruthy();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(request => new URL(request.url).origin === 'https://mcp.example.test')).toBe(true);
    expect(seen[0]?.headers.get('x-fixture-secret')).toBe('never-forward');
    await client.close().catch(() => undefined);
  }, 30_000);
});

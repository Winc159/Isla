import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

const server = new McpServer({ name: 'isla-fixture', version: '1.0.0' });
server.registerTool('ping', { description: 'Returns a deterministic text response.' }, async () => ({ content: [{ type: 'text', text: 'pong' }] }));
server.registerTool('structured', { description: 'Returns deterministic structured content.' }, async () => ({ content: [{ type: 'text', text: 'structured' }], structuredContent: { ok: true, source: 'fixture' } }));
server.registerTool('slow', { description: 'Waits until the caller cancels or the timeout expires.' }, async () => { await new Promise(resolve => setTimeout(resolve, 30_000)); return { content: [{ type: 'text', text: 'late' }] }; });
server.registerTool('failure', { description: 'Returns an MCP error result.' }, async () => ({ isError: true, content: [{ type: 'text', text: 'fixture failure' }] }));
server.registerTool('unsupported', { description: 'Returns a non-text content block.' }, async () => ({ content: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }] }));
server.registerTool('oversize', { description: 'Returns an over-sized result.' }, async () => ({ content: [{ type: 'text', text: 'x'.repeat(70_000) }] }));
server.registerTool('crash', { description: 'Exits the fixture process.' }, async () => { setTimeout(() => process.exit(17), 0); return { content: [{ type: 'text', text: 'closing' }] }; });
serveStdio(() => server);

import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { acceptedContent, inputRequired } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';

const server = new McpServer({ name: 'isla-fixture', version: '1.0.0' });
const pingTool = server.registerTool('ping', { description: 'Returns a deterministic text response.' }, async () => ({ content: [{ type: 'text', text: 'pong' }] }));
server.registerTool('disable_ping', { description: 'Disables the ping tool and sends tools/list_changed.' }, async () => { pingTool.disable(); return { content: [{ type: 'text', text: 'disabled' }] }; });
server.registerTool('structured', { description: 'Returns deterministic structured content.' }, async () => ({ content: [{ type: 'text', text: 'structured' }], structuredContent: { ok: true, source: 'fixture' } }));
server.registerTool('slow', { description: 'Waits until the caller cancels or the timeout expires.' }, async () => { await new Promise(resolve => setTimeout(resolve, 30_000)); return { content: [{ type: 'text', text: 'late' }] }; });
server.registerTool('failure', { description: 'Returns an MCP error result.' }, async () => ({ isError: true, content: [{ type: 'text', text: 'fixture failure' }] }));
server.registerTool('unsupported', { description: 'Returns a non-text content block.' }, async () => ({ content: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }] }));
server.registerTool('oversize', { description: 'Returns an over-sized result.' }, async () => ({ content: [{ type: 'text', text: 'x'.repeat(70_000) }] }));
server.registerTool('crash', { description: 'Exits the fixture process.' }, async () => { setTimeout(() => process.exit(17), 0); return { content: [{ type: 'text', text: 'closing' }] }; });
server.registerTool('ask_destination', { description: 'Requests a destination through MCP Form Elicitation.', inputSchema: z.object({}) }, async (_args, context) => {
  const answer = acceptedContent(context.mcpReq.inputResponses, 'destination');
  if (!answer?.destination) return inputRequired({ inputRequests: { destination: inputRequired.elicit({ message: 'Where should the report be sent?', requestedSchema: { type: 'object', properties: { destination: { type: 'string' } }, required: ['destination'] } }) } });
  return { content: [{ type: 'text', text: `sent to ${answer.destination}` }] };
});
server.registerResource('Fixture readme', 'fixture://readme', { description: 'A deterministic resource.' }, async uri => ({ contents: [{ uri: uri.href, text: 'resource-content' }] }));
server.registerPrompt('summarize', { description: 'A deterministic prompt.', argsSchema: z.object({ topic: z.string() }) }, async ({ topic }) => ({ messages: [{ role: 'user', content: { type: 'text', text: `Summarize: ${topic}` } }] }));
serveStdio(() => server);

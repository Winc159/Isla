import { createInterface } from 'node:readline';

// Minimal MCP stdio peer implemented without the MCP TypeScript SDK. This is
// intentionally independent of Isla's client/server SDK fixtures.
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const resources = [{ uri: 'independent://readme', name: 'Independent readme', description: 'Independent stdio interop resource.' }];
const prompts = [{ name: 'summarize', description: 'Independent summary prompt.', arguments: [{ name: 'topic', required: true }] }];

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

input.on('line', line => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  const { id, method, params = {} } = request;
  if (id === undefined) return;
  if (method === 'initialize') {
    reply(id, { protocolVersion: params.protocolVersion, capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: 'independent-mcp-peer', version: '1.0.0' } });
  } else if (method === 'ping') reply(id, {});
  else if (method === 'tools/list') reply(id, { tools: [{ name: 'ping', description: 'Returns the fixed text pong.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] });
  else if (method === 'tools/call' && params.name === 'ping') reply(id, { content: [{ type: 'text', text: 'pong' }] });
  else if (method === 'resources/list') reply(id, { resources });
  else if (method === 'resources/templates/list') reply(id, { resourceTemplates: [] });
  else if (method === 'resources/read' && params.uri === resources[0].uri) reply(id, { contents: [{ uri: params.uri, mimeType: 'text/plain', text: 'independent-resource-content' }] });
  else if (method === 'prompts/list') reply(id, { prompts });
  else if (method === 'prompts/get' && params.name === 'summarize') reply(id, { description: 'Independent summary prompt.', messages: [{ role: 'user', content: { type: 'text', text: `Independent summary: ${params.arguments?.topic ?? ''}` } }] });
  else process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method or fixture argument not found' } })}\n`);
});

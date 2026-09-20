import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';

export type FixtureResponse = { readonly content?: string; readonly toolCalls?: readonly { readonly id: string; readonly name: string; readonly arguments: string }[]; readonly delayMs?: number };

export class OpenAI_fixtureServer {
  private readonly server = createServer((request, response) => { void this.handle(request, response); });
  private responses: FixtureResponse[] = [];
  private _requestCount = 0;
  port = 0;

  get requestCount(): number { return this._requestCount; }
  enqueue(...responses: FixtureResponse[]): void { this.responses.push(...responses); }

  async start(): Promise<void> {
    this.server.listen(0, '127.0.0.1');
    await once(this.server, 'listening');
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('fixture server did not expose a port');
    this.port = address.port;
  }

  async close(): Promise<void> { if (this.server.listening) { this.server.close(); await once(this.server, 'close'); } }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) { response.statusCode = 404; response.end(); return; }
    this._requestCount += 1;
    for await (const _chunk of request) { /* 消耗请求体，保持 OpenAI 客户端连接可复用 */ }
    const next = this.responses.shift() ?? { content: 'ready' };
    if (next.delayMs) await new Promise(resolve => setTimeout(resolve, next.delayMs));
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ model: 'fixture-model', choices: [{ message: { role: 'assistant', content: next.content ?? '', ...(next.toolCalls ? { tool_calls: next.toolCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) } : {}) } }] }));
  }
}

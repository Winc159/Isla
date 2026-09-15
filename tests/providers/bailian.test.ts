import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createBailianPlugin } from '../../src/providers/bailian.js';
import { IslaRuntime } from '../../src/core/runtime.js';

const endpoint = 'https://workspace.example/compatible-mode/v1/chat/completions';
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function session() {
  const runtime = new IslaRuntime();
  runtime.use(createBailianPlugin({ provider: 'bailian', model: 'qwen-plus', apiKey: 'test-only-key', baseURL: 'https://workspace.example/compatible-mode/v1', timeoutMs: 1000, debug: false, maxContextTurns: 20, maxContextChars: 60000, contextRetainTurns: 6, modelRetries: 0, memoryEnabled: false }));
  return runtime.createSession({ providerId: 'bailian' });
}

describe('Bailian provider contract', () => {
  it('sends Chat Completions and maps text and usage', async () => {
    let body: unknown;
    server.use(http.post(endpoint, async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({ model: 'qwen-plus', choices: [{ message: { role: 'assistant', content: '你好' } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
    }));
    await expect(session().send('你好')).resolves.toMatchObject({ text: '你好' });
    expect(body).toEqual({ model: 'qwen-plus', messages: [{ role: 'user', content: '你好' }], stream: false });
  });

  it('reports conservative capabilities and rejects empty responses', async () => {
    const runtime = new IslaRuntime();
    const provider = createBailianPlugin({ provider: 'bailian', model: 'qwen-plus', apiKey: 'test-only-key', baseURL: 'https://workspace.example/compatible-mode/v1', timeoutMs: 1000, debug: false, maxContextTurns: 20, maxContextChars: 60000, contextRetainTurns: 6, modelRetries: 0, memoryEnabled: false });
    runtime.use(provider);
    expect(runtime.getProviderCapabilities('bailian')).toEqual({ toolCalling: true, nativeStreaming: false, streamingToolCalls: false });
    server.use(http.post(endpoint, () => HttpResponse.json({ choices: [{ message: { role: 'assistant', content: '' } }] })));
    await expect(runtime.createSession({ providerId: 'bailian' }).send('test')).rejects.toThrow('空回答');
  });

  it('maps structured tool calls and preserves the follow-up message shape', async () => {
    let body: unknown; let calls = 0;
    server.use(http.post(endpoint, async ({ request }) => { body = await request.json(); calls += 1; if (calls > 1) return HttpResponse.json({ model: 'qwen-plus', choices: [{ message: { role: 'assistant', content: '完成' } }] }); return HttpResponse.json({ model: 'qwen-plus', choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read_text_file', arguments: '{"path":"README.md"}' } }] } }] }); }));
    const runtime = new IslaRuntime();
    runtime.use(createBailianPlugin({ provider: 'bailian', model: 'qwen-plus', apiKey: 'test-only-key', baseURL: 'https://workspace.example/compatible-mode/v1', timeoutMs: 1000, debug: false, maxContextTurns: 20, maxContextChars: 60000, contextRetainTurns: 6, modelRetries: 0, memoryEnabled: false }));
    const response = await runtime.createSession({ providerId: 'bailian', enableTools: true, projectRoot: process.cwd() }).send('读取 README');
    expect(response.text).toBeDefined();
    expect(body).toMatchObject({ model: 'qwen-plus', stream: false });
    expect((body as { tools?: unknown[] }).tools).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'function', function: expect.objectContaining({ name: 'read_text_file' }) })]));
  });
});

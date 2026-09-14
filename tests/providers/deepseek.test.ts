import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse, delay } from 'msw';
import { setupServer } from 'msw/node';
import { createDeepSeekPlugin, mapDeepSeekStreamEvent, parseDsmlToolCalls } from '../../src/providers/deepseek.js';
import { IslaRuntime } from '../../src/core/runtime.js';

const endpoint = 'https://api.deepseek.com/chat/completions';
const server = setupServer();
const provider = () => {
  const runtime = new IslaRuntime();
  runtime.use(createDeepSeekPlugin({ provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'test-only-key', timeoutMs: 100, debug: false, maxContextTurns: 20, streaming: false }));
  return runtime.createSession({ providerId: 'deepseek' });
};

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('DeepSeek provider contract', () => {
  it('maps Responses semantic stream events through the shared adapter', () => {
    expect(mapDeepSeekStreamEvent({ type: 'response.output_text.delta', sequence_number: 1, content_index: 0, delta: '你好' })).toEqual({ type: 'text_delta', index: 0, delta: '你好' });
    expect(mapDeepSeekStreamEvent({ type: 'response.function_call_arguments.done', sequence_number: 2, output_index: 0, item_id: 'call-1', name: 'read_text_file', arguments: '{"path":"README.md"}' })).toMatchObject({ type: 'tool_call_delta', index: 0, id: 'call-1', name: 'read_text_file' });
    expect(mapDeepSeekStreamEvent({ type: 'response.completed', sequence_number: 3, response: { model: 'deepseek-v4-flash' } })).toEqual({ type: 'finish', reason: 'stop', model: 'deepseek-v4-flash' });
  });
  it('parses multiple DSML calls and all named parameters', () => {
    const calls = parseDsmlToolCalls('<invoke name="write_text_file"><parameter name="path">a.txt</parameter><parameter name="content">a&amp;b</parameter></invoke><invoke name="read_file"><parameter name="path">b.txt</parameter></invoke>');
    expect(calls.map(call => ({ name: call.name, arguments: JSON.parse(call.arguments) }))).toEqual([
      { name: 'write_text_file', arguments: { path: 'a.txt', content: 'a&b' } },
      { name: 'read_text_file', arguments: { path: 'b.txt' } },
    ]);
    expect(calls.every(call => call.id.startsWith('dsml-'))).toBe(true);
  });
  it('converts textual DSML tool calls into the normal tool loop', async () => {
    const requests: Array<{ messages?: Array<{ role: string; tool_call_id?: string; content?: string }> }> = [];
    server.use(http.post(endpoint, async ({ request }) => {
      requests.push(await request.json() as typeof requests[number]);
      if (requests.length === 1) {
        return HttpResponse.json({ model: 'deepseek-v4-flash', choices: [{ message: { role: 'assistant', content: '<｜｜DSML｜｜tool_calls>\n<｜｜DSML｜｜invoke name="read_file">\n<｜｜DSML｜｜parameter name="path" string="true">AGENTS.md</｜｜DSML｜｜parameter>\n</｜｜DSML｜｜invoke>\n</｜｜DSML｜｜tool_calls>' } }] });
      }
      return HttpResponse.json({ model: 'deepseek-v4-flash', choices: [{ message: { role: 'assistant', content: '总结完成' } }] });
    }));
    const runtime = new IslaRuntime();
    runtime.use(createDeepSeekPlugin({ provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'test-only-key', timeoutMs: 100, debug: false, maxContextTurns: 20, streaming: false }));
    const session = runtime.createSession({ providerId: 'deepseek', enableTools: true, projectRoot: process.cwd() });
    await expect(session.send('读取 AGENTS.md')).resolves.toMatchObject({ text: '总结完成' });
    expect(requests[1]?.messages?.at(-1)).toMatchObject({ role: 'tool', content: expect.stringContaining('Isla 项目约束') });
    expect(requests[1]?.messages?.at(-1)?.tool_call_id).toMatch(/^dsml-/);
  });
  it('sends the model, ordered messages, and authorization', async () => {
    let body: unknown;
    let authorization = '';
    server.use(http.post(endpoint, async ({ request }) => {
      body = await request.json();
      authorization = request.headers.get('authorization') ?? '';
      return HttpResponse.json({ model: 'deepseek-v4-flash', choices: [{ message: { role: 'assistant', content: 'master，你好。' } }] });
    }));
    const session = provider();
    await session.send('你好');
    expect(body).toEqual({ model: 'deepseek-v4-flash', messages: [{ role: 'user', content: '你好' }], thinking: { type: 'disabled' } });
    expect(authorization).toBe('Bearer test-only-key');
  });

  it('supports multi-turn history through the Isla session', async () => {
    const requests: unknown[] = [];
    server.use(http.post(endpoint, async ({ request }) => {
      requests.push(await request.json());
      return HttpResponse.json({ model: 'deepseek-v4-flash', choices: [{ message: { role: 'assistant', content: 'ok' } }] });
    }));
    const session = provider();
    await session.send('第一句');
    await session.send('第二句');
    expect(requests[1]).toEqual({ model: 'deepseek-v4-flash', thinking: { type: 'disabled' }, messages: [
      { role: 'user', content: '第一句' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: '第二句' },
    ] });
  });


  it('rejects non-2xx, empty text, network errors, and timeout', async () => {
    server.use(http.post(endpoint, () => HttpResponse.json({ error: { message: 'bad request' } }, { status: 401 })));
    await expect(provider().send('test')).rejects.toThrow();
    server.resetHandlers();
    server.use(http.post(endpoint, () => HttpResponse.json({ choices: [{ message: { role: 'assistant', content: '' } }] })));
    await expect(provider().send('test')).rejects.toThrow('空回答');
    server.resetHandlers();
    server.use(http.post(endpoint, () => HttpResponse.error()));
    await expect(provider().send('test')).rejects.toThrow();
    server.resetHandlers();
    server.use(http.post(endpoint, async () => { await delay(250); return HttpResponse.json({ choices: [{ message: { role: 'assistant', content: 'late' } }] }); }));
    await expect(provider().send('test')).rejects.toThrow();
  }, 1000);
});

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse, delay } from 'msw';
import { setupServer } from 'msw/node';
import { createDeepSeekPlugin } from '../../src/providers/deepseek.js';
import { IslaRuntime } from '../../src/core/runtime.js';

const endpoint = 'https://api.deepseek.com/chat/completions';
const server = setupServer();
const provider = () => {
  const runtime = new IslaRuntime();
  runtime.use(createDeepSeekPlugin({ provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'test-only-key', timeoutMs: 100, debug: false, maxContextTurns: 20 }));
  return runtime.createSession({ providerId: 'deepseek' });
};

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('DeepSeek provider contract', () => {
  it('converts textual DSML tool calls into the normal tool loop', async () => {
    const requests: Array<{ messages?: Array<{ role: string; tool_call_id?: string; content?: string }> }> = [];
    server.use(http.post(endpoint, async ({ request }) => {
      requests.push(await request.json() as typeof requests[number]);
      if (requests.length === 1) {
        return HttpResponse.json({ model: 'deepseek-v4-flash', choices: [{ message: { role: 'assistant', content: '{"kind":"inspect","goal":"读取 AGENTS.md","needsHistory":false,"needsTools":true,"requiresUserConfirmation":false,"missingInformation":[]}' } }] });
      }
      if (requests.length === 2) {
        return HttpResponse.json({ model: 'deepseek-v4-flash', choices: [{ message: { role: 'assistant', content: '<｜｜DSML｜｜tool_calls>\n<｜｜DSML｜｜invoke name="read_file">\n<｜｜DSML｜｜parameter name="path" string="true">AGENTS.md</｜｜DSML｜｜parameter>\n</｜｜DSML｜｜invoke>\n</｜｜DSML｜｜tool_calls>' } }] });
      }
      return HttpResponse.json({ model: 'deepseek-v4-flash', choices: [{ message: { role: 'assistant', content: '总结完成' } }] });
    }));
    const runtime = new IslaRuntime();
    runtime.use(createDeepSeekPlugin({ provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'test-only-key', timeoutMs: 100, debug: false, maxContextTurns: 20 }));
    const session = runtime.createSession({ providerId: 'deepseek', enableTools: true, projectRoot: process.cwd() });
    await expect(session.send('读取 AGENTS.md')).resolves.toMatchObject({ text: '总结完成' });
    expect(requests[2]?.messages?.at(-1)).toMatchObject({ role: 'tool', content: expect.stringContaining('Isla 项目约束') });
    expect(requests[2]?.messages?.at(-1)?.tool_call_id).toMatch(/^dsml-/);
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

  it('serializes a forced write tool choice for a confirmed execution', async () => {
    const bodies: Array<{ tool_choice?: unknown; tools?: unknown[] }> = [];
    server.use(http.post(endpoint, async ({ request }) => {
      const body = await request.json() as { tool_choice?: unknown; tools?: unknown[] };
      bodies.push(body);
      if (!body.tools) return HttpResponse.json({ model: 'deepseek-v4-flash', choices: [{ message: { role: 'assistant', content: '{"kind":"execute","goal":"创建文件","needsHistory":false,"needsTools":true,"requiresUserConfirmation":true,"missingInformation":[]}' } }] });
      return HttpResponse.json({ model: 'deepseek-v4-flash', choices: [{ message: { role: 'assistant', content: '未调用工具' } }] });
    }));
    const session = new IslaRuntime().use(createDeepSeekPlugin({ provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'test-only-key', timeoutMs: 100, debug: false, maxContextTurns: 20 })).createSession({ providerId: 'deepseek', enableTools: true, projectRoot: process.cwd() });
    await session.send('创建文件');
    await session.send('确认执行');
    const forced = bodies.find(body => body.tool_choice);
    expect(forced?.tool_choice).toEqual({ type: 'function', function: { name: 'write_text_file' } });
    expect(forced?.tools).toBeTruthy();
  });

  it('rejects non-2xx, empty text, network errors, and timeout', async () => {
    server.use(http.post(endpoint, () => HttpResponse.json({ error: { message: 'bad request' } }, { status: 401 })));
    await expect(provider().send('test')).rejects.toThrow();
    server.resetHandlers();
    server.use(http.post(endpoint, () => HttpResponse.json({ choices: [{ message: { role: 'assistant', content: '' } }] })));
    await expect(provider().send('test')).rejects.toThrow('DeepSeek returned no text');
    server.resetHandlers();
    server.use(http.post(endpoint, () => HttpResponse.error()));
    await expect(provider().send('test')).rejects.toThrow();
    server.resetHandlers();
    server.use(http.post(endpoint, async () => { await delay(250); return HttpResponse.json({ choices: [{ message: { role: 'assistant', content: 'late' } }] }); }));
    await expect(provider().send('test')).rejects.toThrow();
  }, 1000);
});

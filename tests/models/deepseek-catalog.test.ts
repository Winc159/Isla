import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { listDeepSeekModels } from '../../src/models/deepseek-catalog.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('DeepSeek model catalog', () => {
  it('maps only the official shared fields', async () => {
    let authorization = '';
    server.use(http.get('https://api.deepseek.com/models', ({ request }) => {
      authorization = request.headers.get('authorization') ?? '';
      return HttpResponse.json({ data: [
        { id: 'deepseek-chat', object: 'model', owned_by: 'deepseek', context_length: 64000, price: 'secret' },
      ] });
    }));
    await expect(listDeepSeekModels('test-only-key')).resolves.toEqual([{ id: 'deepseek-chat', owner: 'deepseek' }]);
    expect(authorization).toBe('Bearer test-only-key');
  });

  it('fails closed for malformed responses', async () => {
    server.use(http.get('https://api.deepseek.com/models', () => HttpResponse.json({}))); 
    await expect(listDeepSeekModels('test-only-key')).rejects.toThrow('模型服务请求失败');
  });
});

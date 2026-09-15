import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { listBailianModels } from '../../src/models/bailian-catalog.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('Bailian model catalog', () => {
  it('queries the platform model endpoint with pagination and projects safe fields', async () => {
    const requests: string[] = [];
    server.use(http.get('https://workspace.example/api/v1/models', ({ request }) => {
      requests.push(request.url);
      const page = new URL(request.url).searchParams.get('page_no');
      return HttpResponse.json({ output: { total: 2, models: page === '1' ? [{ model: 'qwen-plus', name: 'Qwen Plus', provider: 'qwen', inference_provider: 'aliyun-bailian', capabilities: ['Text'], features: ['FunctionCalling'], model_info: { context_window: 128000, max_input_tokens: 120000, max_output_tokens: 8000 }, prices: [{ secret: 'must-not-project' }] }] : [{ model: 'deepseek-v4-flash', capabilities: [], features: [] }] } });
    }));
    await expect(listBailianModels('https://workspace.example/compatible-mode/v1', 'test-only-key')).resolves.toEqual([
      expect.objectContaining({ id: 'qwen-plus', provider: 'qwen', inferenceProvider: 'aliyun-bailian', contextWindow: 128000 }),
      expect.objectContaining({ id: 'deepseek-v4-flash' }),
    ]);
    expect(requests[0]).toContain('page_no=1');
    expect(requests[1]).toContain('page_no=2');
  });

  it('fails closed for malformed responses', async () => {
    server.use(http.get('https://workspace.example/api/v1/models', () => HttpResponse.json({ output: {} })));
    await expect(listBailianModels('https://workspace.example/compatible-mode/v1', 'test-only-key')).rejects.toThrow('模型服务请求失败');
  });
});

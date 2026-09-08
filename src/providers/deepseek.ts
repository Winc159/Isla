import OpenAI from 'openai';
import type { RuntimePlugin } from '../core/plugin.js';
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from '../core/types.js';
import type { DeepSeekConfig } from '../config.js';
export function createDeepSeekPlugin(config: DeepSeekConfig): RuntimePlugin {
  return {
    name: 'deepseek',
    setup: (c) => c.registerProvider(new DeepSeekProvider(config)),
  };
}
class DeepSeekProvider implements ModelProvider {
  readonly id = 'deepseek';
  readonly model: string;
  private readonly client: OpenAI;
  constructor(config: DeepSeekConfig) {
    this.model = config.model;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: 'https://api.deepseek.com',
      timeout: config.timeoutMs,
      maxRetries: 0,
    });
  }
  async generate(request: ModelRequest): Promise<ModelResponse> {
    const body = {
      model: this.model,
      messages: [...request.messages],
      thinking: { type: 'disabled' as const },
    };
    const r = await this.client.chat.completions.create(body);
    const text = r.choices[0]?.message.content;
    if (!text?.trim()) throw new Error('DeepSeek returned no text');
    return {
      text,
      model: r.model,
      ...(r.usage
        ? {
            usage: {
              input: r.usage.prompt_tokens,
              output: r.usage.completion_tokens,
              total: r.usage.total_tokens,
            },
          }
        : {}),
    };
  }
}

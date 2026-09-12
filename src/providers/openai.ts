import OpenAI from "openai";
import type { RuntimePlugin } from "../core/plugin.js";
import type { ModelProvider, ModelRequest, ModelResponse } from "../core/types.js";
import type { OpenAIConfig } from "../config.js";
import { normalizeProviderError, RuntimeError } from "../core/errors.js";
export function createOpenAIPlugin(config: OpenAIConfig): RuntimePlugin { return { name: "openai", setup: c => c.registerProvider(new OpenAIProvider(config)) }; }
class OpenAIProvider implements ModelProvider {
  readonly id = "openai"; readonly model: string; private readonly client: OpenAI;
  constructor(config: OpenAIConfig) { this.model = config.model; this.client = new OpenAI({ apiKey: config.apiKey, timeout: config.timeoutMs, maxRetries: 0 }); }
  async generate(request: ModelRequest): Promise<ModelResponse> { try { const response = await this.client.responses.create({ model: this.model, input: request.messages.map(m => ({ role: m.role, content: m.content })) as never }); if (!response.output_text?.trim()) throw new RuntimeError({ code: "PROVIDER_EMPTY_RESPONSE", recoverable: false, message: "OpenAI 模型返回了空回答。" }); return { text: response.output_text, model: response.model, ...(response.usage ? { usage: { input: response.usage.input_tokens, output: response.usage.output_tokens, total: response.usage.total_tokens } } : {}) }; } catch (error) { throw normalizeProviderError(error, "OpenAI"); } }
}

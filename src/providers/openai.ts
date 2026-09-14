import OpenAI from "openai";
import type { RuntimePlugin } from "../core/plugin.js";
import type { ModelCallOptions, ModelProvider, ModelRequest, ModelResponse } from "../core/types.js";
import type { ModelStreamEvent } from "../core/model-stream.js";
import type { OpenAIConfig } from "../config.js";
import { normalizeProviderError, RuntimeError } from "../core/errors.js";
export function createOpenAIPlugin(config: OpenAIConfig): RuntimePlugin { return { name: "openai", setup: c => c.registerProvider(new OpenAIProvider(config)) }; }
class OpenAIProvider implements ModelProvider {
  readonly id = "openai"; readonly model: string; readonly streamingEnabled: boolean; private readonly client: OpenAI;
  constructor(config: OpenAIConfig) { this.model = config.model; this.streamingEnabled = config.streaming !== false; this.client = new OpenAI({ apiKey: config.apiKey, timeout: config.timeoutMs, maxRetries: 0 }); }
  async generate(request: ModelRequest, options?: ModelCallOptions): Promise<ModelResponse> { try { const response = await this.client.responses.create({ model: this.model, input: request.messages.map(m => ({ role: m.role, content: m.content })) as never }, options?.signal ? { signal: options.signal } : undefined); if (!response.output_text?.trim()) throw new RuntimeError({ code: "PROVIDER_EMPTY_RESPONSE", recoverable: false, message: "OpenAI 模型返回了空回答。" }); return { text: response.output_text, model: response.model, ...(response.usage ? { usage: { input: response.usage.input_tokens, output: response.usage.output_tokens, total: response.usage.total_tokens } } : {}) }; } catch (error) { throw normalizeProviderError(error, "OpenAI"); } }
  generateStream(request: ModelRequest, options?: ModelCallOptions): AsyncIterable<ModelStreamEvent> { return this.stream(request, options); }

  private async *stream(request: ModelRequest, options?: ModelCallOptions): AsyncIterable<ModelStreamEvent> {
    try {
      const response = await this.client.responses.create({ model: this.model, input: request.messages.map(m => ({ role: m.role, content: m.content })) as never, stream: true }, options?.signal ? { signal: options.signal } : undefined);
      for await (const raw of response) {
        const usage = raw && typeof raw === "object" && (raw as unknown as Record<string, unknown>).type === "response.completed" ? responseUsage((raw as unknown as Record<string, unknown>).response) : undefined;
        if (usage) yield { type: "usage", usage };
        const event = mapOpenAIStreamEvent(raw);
        if (event) yield event;
      }
    } catch (error) {
      throw normalizeProviderError(error, "OpenAI");
    }
  }
}

export function mapOpenAIStreamEvent(raw: unknown): ModelStreamEvent | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const event = raw as Record<string, unknown>;
  const type = typeof event.type === "string" ? event.type : "";
  if (type === "response.output_text.delta" && typeof event.delta === "string") return { type: "text_delta", index: typeof event.content_index === "number" ? event.content_index : 0, delta: event.delta };
  if (type === "response.function_call_arguments.delta" && typeof event.delta === "string") return { type: "tool_call_delta", index: typeof event.output_index === "number" ? event.output_index : 0, ...(typeof event.item_id === "string" ? { id: event.item_id } : {}), argumentsDelta: event.delta };
  if (type === "response.function_call_arguments.done") return { type: "tool_call_delta", index: typeof event.output_index === "number" ? event.output_index : 0, ...(typeof event.item_id === "string" ? { id: event.item_id } : {}), ...(typeof event.name === "string" ? { name: event.name } : {}), argumentsDelta: "" };
  if ((type === "response.output_item.added" || type === "response.output_item.done") && event.item && typeof event.item === "object") {
    const item = event.item as Record<string, unknown>;
    if (item.type === "function_call") return { type: "tool_call_delta", index: typeof event.output_index === "number" ? event.output_index : 0, ...(typeof item.id === "string" ? { id: item.id } : typeof item.call_id === "string" ? { id: item.call_id } : {}), ...(typeof item.name === "string" ? { name: item.name } : {}), argumentsDelta: "" };
  }
  if (type === "response.completed") { const model = responseModel(event.response); return model ? { type: "finish", reason: "stop", model } : { type: "finish", reason: "stop" }; }
  if (type === "response.incomplete") { const model = responseModel(event.response); return { type: "finish", reason: "max_tokens", ...(model ? { model } : {}), error: { code: "PROVIDER_INVALID_RESPONSE", recoverable: false, message: "OpenAI 模型输出未完整结束。" } }; }
  if (type === "response.failed" || type === "error") return { type: "finish", reason: "failed", error: { code: "PROVIDER_INVALID_RESPONSE", recoverable: false, message: "OpenAI 模型流失败。" } };
  if (type === "response.output_text.done" && typeof event.text === "string") return undefined;
  return undefined;
}

function responseModel(value: unknown): string | undefined { return value && typeof value === "object" && typeof (value as Record<string, unknown>).model === "string" ? (value as Record<string, unknown>).model as string : undefined; }
function responseUsage(value: unknown): { readonly input: number; readonly output: number; readonly total: number } | undefined { const usage = value && typeof value === "object" ? (value as Record<string, unknown>).usage : undefined; if (!usage || typeof usage !== "object") return undefined; const u = usage as Record<string, unknown>; return typeof u.input_tokens === "number" && typeof u.output_tokens === "number" && typeof u.total_tokens === "number" ? { input: u.input_tokens, output: u.output_tokens, total: u.total_tokens } : undefined; }

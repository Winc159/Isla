import OpenAI from "openai";
import type { RuntimePlugin } from "../core/plugin.js";
import type { ModelProvider, ModelRequest, ModelResponse } from "../core/types.js";
import type { LocalConfig } from "../config.js";
export function createLocalPlugin(config: LocalConfig): RuntimePlugin { return { name: "local", setup: c => c.registerProvider(new LocalProvider(config)) }; }
class LocalProvider implements ModelProvider { readonly id = "local"; readonly model: string; private readonly client: OpenAI; constructor(config: LocalConfig) { this.model = config.model; this.client = new OpenAI({ apiKey: config.apiKey ?? "isla-local", baseURL: config.baseURL, timeout: config.timeoutMs, maxRetries: 0 }); } async generate(request: ModelRequest): Promise<ModelResponse> { const r = await this.client.chat.completions.create({ model: this.model, messages: [...request.messages] as never, stream: false }); const text = r.choices[0]?.message.content; if (!text?.trim()) throw new Error("Local provider returned no text"); return { text, model: r.model, ...(r.usage ? { usage: { input: r.usage.prompt_tokens, output: r.usage.completion_tokens, total: r.usage.total_tokens } } : {}) }; } }

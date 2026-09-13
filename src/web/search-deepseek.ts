import { WebSearchError } from "./errors.js";
import { normalizeWebSearchResult, validateWebSearchRequest, type WebSearchProvider, type WebSearchRequest, type WebSearchResult, type WebSearchSource } from "./types.js";

export interface DeepSeekSearchProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly endpoint?: string;
  readonly apiVersion?: string;
  readonly maxUses?: number;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

const DEFAULT_ENDPOINT = "https://api.deepseek.com/anthropic/v1/messages";
const DEFAULT_API_VERSION = "2023-06-01";
const DEFAULT_MAX_USES = 5;
const DEFAULT_TIMEOUT_MS = 30_000;

export function createDeepSeekSearchProvider(options: DeepSeekSearchProviderOptions): WebSearchProvider {
  const request = new DeepSeekSearchHttpProvider(options);
  return { id: "deepseek-official", search: (input, callOptions) => request.search(input, callOptions?.signal) };
}

class DeepSeekSearchHttpProvider {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  constructor(private readonly options: DeepSeekSearchProviderOptions) {
    if (!options.apiKey.trim()) throw new WebSearchError("WEB_SEARCH_UNAVAILABLE", "DeepSeek Search API Key 未配置。");
    if (!options.model.trim()) throw new WebSearchError("WEB_SEARCH_UNAVAILABLE", "DeepSeek Search model 未配置。");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    validateWebSearchRequest(request);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal?.aborted) throw new WebSearchError("TURN_CANCELLED", "当前回合已取消。");
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": this.options.apiKey, "anthropic-version": this.options.apiVersion ?? DEFAULT_API_VERSION },
        body: JSON.stringify({ model: this.options.model, max_tokens: 1024, messages: [{ role: "user", content: [{ type: "text", text: request.query }] }], tools: [{ type: "web_search_20250305", name: "web_search", max_uses: this.options.maxUses ?? DEFAULT_MAX_USES }] }),
        signal: controller.signal,
      });
      if (!response.ok) {
        if (signal?.aborted) throw new WebSearchError("TURN_CANCELLED", "当前回合已取消。");
        if (response.status === 429) throw new WebSearchError("WEB_SEARCH_RATE_LIMITED", "DeepSeek Search 请求受到限流。");
        if (response.status === 401 || response.status === 403) throw new WebSearchError("WEB_SEARCH_UNAVAILABLE", "DeepSeek Search 凭据不可用。");
        throw new WebSearchError("WEB_SEARCH_NETWORK_ERROR", `DeepSeek Search 服务返回 HTTP ${response.status}。`);
      }
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new WebSearchError("WEB_SEARCH_RESPONSE_INVALID", "DeepSeek Search 返回了无法解析的响应。"); }
      if (signal?.aborted) throw new WebSearchError("TURN_CANCELLED", "当前回合已取消。");
      const result = parseDeepSeekSearchResponse(payload);
      return normalizeWebSearchResult(result, request.maxResults);
    } catch (error) {
      if (error instanceof WebSearchError) throw error;
      if (signal?.aborted) throw new WebSearchError("TURN_CANCELLED", "当前回合已取消。");
      if (error instanceof DOMException && error.name === "AbortError") throw new WebSearchError("WEB_SEARCH_TIMEOUT", "DeepSeek Search 请求超时。");
      throw new WebSearchError("WEB_SEARCH_NETWORK_ERROR", "DeepSeek Search 网络请求失败。", error);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}

function parseDeepSeekSearchResponse(value: unknown): WebSearchResult {
  if (!isRecord(value) || !Array.isArray(value.content)) throw new WebSearchError("WEB_SEARCH_RESPONSE_INVALID", "DeepSeek Search 响应缺少结构化 content。");
  const sources: WebSearchSource[] = [];
  let content: string | undefined;
  let foundStructured = false;
  for (const block of value.content) {
    if (!isRecord(block) || typeof block.type !== "string") continue;
    if (block.type === "text" && typeof block.text === "string" && block.text.trim()) content = content === undefined ? block.text : `${content}\n${block.text}`;
    if (block.type !== "web_search_tool_result") continue;
    foundStructured = true;
    const entries = Array.isArray(block.content) ? block.content : [];
    for (const entry of entries) {
      if (!isRecord(entry) || typeof entry.url !== "string") continue;
      sources.push({ url: entry.url, ...(typeof entry.title === "string" ? { title: entry.title } : {}), ...(typeof entry.snippet === "string" ? { snippet: entry.snippet } : {}), ...(typeof entry.published_at === "string" ? { publishedAt: entry.published_at } : {}) });
    }
  }
  if (!foundStructured) throw new WebSearchError("WEB_SEARCH_RESPONSE_INVALID", "DeepSeek Search 响应没有结构化搜索结果。");
  return { ...(content === undefined ? {} : { content }), sources, truncated: false };
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

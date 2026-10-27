import { WebSearchError } from "./errors.js";
import { normalizeWebSearchResult, validateWebSearchRequest, type WebSearchProvider, type WebSearchRequest, type WebSearchResult, type WebSearchSource } from "./types.js";
import { resolvePublicAddresses, type PublicAddress } from "./network.js";
import { requestPinned, type PinnedResponse } from "./transport.js";

interface SearchResponse { readonly ok: boolean; readonly status: number; readonly headers: { get(name: string): string | null }; readonly body: ReadableStream<Uint8Array> | null; }

export interface DeepSeekSearchProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly endpoint?: string;
  readonly apiVersion?: string;
  readonly maxUses?: number;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly resolveAddresses?: (hostname: string, signal: AbortSignal) => Promise<PublicAddress[]>;
  readonly requestPinned?: (url: URL, addresses: readonly PublicAddress[], headers: Record<string, string>, signal: AbortSignal, body: string) => Promise<PinnedResponse>;
}

const DEFAULT_ENDPOINT = "https://api.deepseek.com/anthropic/v1/messages";
const DEFAULT_API_VERSION = "2023-06-01";
const DEFAULT_MAX_USES = 5;
const DEFAULT_TIMEOUT_MS = 30_000;

export function createDeepSeekSearchProvider(options: DeepSeekSearchProviderOptions): WebSearchProvider {
  const request = new DeepSeekSearchHttpProvider(options);
  return { id: "deepseek-official", networkHost: new URL(options.endpoint ?? DEFAULT_ENDPOINT).hostname.toLowerCase(), search: (input, callOptions) => request.search(input, callOptions?.signal) };
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
    const endpoint = new URL(this.endpoint);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash) throw new WebSearchError("WEB_SEARCH_UNAVAILABLE", "DeepSeek Search endpoint 必须是无凭据的 HTTPS 地址。");
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
      const endpoint = new URL(this.endpoint);
      const body = JSON.stringify({ model: this.options.model, max_tokens: 1024, messages: [{ role: "user", content: [{ type: "text", text: request.query }] }], tools: [{ type: "web_search_20250305", name: "web_search", max_uses: this.options.maxUses ?? DEFAULT_MAX_USES }] });
      const headers = { "content-type": "application/json", "x-api-key": this.options.apiKey, "anthropic-version": this.options.apiVersion ?? DEFAULT_API_VERSION };
      let pinned: PinnedResponse | undefined;
      const response = (this.options.fetch
        ? await this.fetchImpl(this.endpoint, { method: "POST", headers, body, signal: controller.signal, redirect: "manual" })
        : (pinned = await (this.options.requestPinned ?? ((url, addresses, requestHeaders, activeSignal, requestBody) => requestPinned(url, addresses, requestHeaders, activeSignal, undefined, { method: "POST", body: requestBody })))(endpoint, await (this.options.resolveAddresses ?? ((hostname, activeSignal) => resolvePublicAddresses(hostname, activeSignal)))(endpoint.hostname, controller.signal), headers, controller.signal, body)).response) as SearchResponse;
      try {
      if (!response.ok) {
        if (signal?.aborted) throw new WebSearchError("TURN_CANCELLED", "当前回合已取消。");
        if (response.status === 429) throw new WebSearchError("WEB_SEARCH_RATE_LIMITED", "DeepSeek Search 请求受到限流。");
        if (response.status === 401 || response.status === 403) throw new WebSearchError("WEB_SEARCH_UNAVAILABLE", "DeepSeek Search 凭据不可用。");
        throw new WebSearchError("WEB_SEARCH_NETWORK_ERROR", `DeepSeek Search 服务返回 HTTP ${response.status}。`);
      }
      if (response.status >= 300 && response.status < 400) throw new WebSearchError("WEB_SEARCH_NETWORK_ERROR", "DeepSeek Search 服务不允许重定向。");
      let payload: unknown;
      try { payload = JSON.parse(await readCappedText(response, 1_000_000)); } catch (error) {
        if (error instanceof WebSearchError) throw error;
        throw new WebSearchError("WEB_SEARCH_RESPONSE_INVALID", "DeepSeek Search 返回了无法解析的响应。");
      }
      if (signal?.aborted) throw new WebSearchError("TURN_CANCELLED", "当前回合已取消。");
      const result = parseDeepSeekSearchResponse(payload);
      return normalizeWebSearchResult(result, request.maxResults);
      } finally {
        await pinned?.close();
      }
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

async function readCappedText(response: SearchResponse, maxBytes: number): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number.isFinite(Number(declared)) && Number(declared) > maxBytes) {
    await response.body?.cancel();
    throw new WebSearchError("WEB_SEARCH_RESPONSE_INVALID", "DeepSeek Search 响应超过大小上限。");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > maxBytes) throw new WebSearchError("WEB_SEARCH_RESPONSE_INVALID", "DeepSeek Search 响应超过大小上限。");
      chunks.push(item.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
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

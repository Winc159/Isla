import type { PublicAddress } from "./network.js";
import { resolvePublicAddresses } from "./network.js";
import { WebFetchError } from "./errors.js";
import type { WebFetchConfigLike, WebFetchRequest, WebFetchResult } from "./types.js";
import { classifyContentType, decoderForCharset, isSameOrigin, parseCharset, resolveRedirect, validateFetchUrl } from "./policy.js";
import { requestPinned, type PinnedResponse } from "./transport.js";
import type { Response } from "undici";

export interface HttpFetchConfig extends WebFetchConfigLike {
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly maxRedirects: number;
  readonly userAgent: string;
}

export interface HttpFetchDeps {
  readonly resolveAddresses?: (hostname: string, signal: AbortSignal) => Promise<PublicAddress[]>;
  readonly requestPinned?: (url: URL, addresses: readonly PublicAddress[], headers: Record<string, string>, signal: AbortSignal) => Promise<PinnedResponse>;
}

export class HttpFetchProvider {
  constructor(private readonly config: HttpFetchConfig, private readonly deps: HttpFetchDeps = {}) {}

  async fetch(request: WebFetchRequest, signal?: AbortSignal, allowedUrls: readonly string[] = []): Promise<WebFetchResult> {
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) throw new WebFetchError("TURN_CANCELLED", "当前回合已取消。");
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort("ISLA_WEB_FETCH_TIMEOUT"), this.config.timeoutMs);
    try {
      return await this.followAndRead(request.url, controller.signal, allowedUrls);
    } catch (error) {
      if (signal?.aborted) throw new WebFetchError("TURN_CANCELLED", "当前回合已取消。", error);
      if (controller.signal.aborted && controller.signal.reason === "ISLA_WEB_FETCH_TIMEOUT") throw new WebFetchError("WEB_FETCH_TIMEOUT", "网络获取超时。", error);
      if (error instanceof WebFetchError) throw error;
      throw new WebFetchError("WEB_NETWORK_ERROR", "网络获取失败。", error);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  private async followAndRead(initialUrl: string, signal: AbortSignal, allowedUrls: readonly string[]): Promise<WebFetchResult> {
    let current = validateFetchUrl(initialUrl, this.config.allowedHosts, allowedUrls);
    const requestedUrl = current.toString();
    let redirects = 0;
    for (;;) {
      if (signal.aborted) throw new WebFetchError("TURN_CANCELLED", "当前回合已取消.");
      const addresses = await (this.deps.resolveAddresses ?? ((hostname, activeSignal) => resolvePublicAddresses(hostname, activeSignal)))(current.hostname, signal);
      const request = await (this.deps.requestPinned ?? ((url, ips, headers, activeSignal) => requestPinned(url, ips, headers, activeSignal)))(current, addresses, { "user-agent": this.config.userAgent, accept: "text/html,application/xhtml+xml,text/*;q=0.9,application/json;q=0.8" }, signal);
      try {
        if (isRedirectStatus(request.response.status)) {
          if (redirects >= this.config.maxRedirects) throw new WebFetchError("WEB_REDIRECT_BLOCKED", "超过重定向次数上限。");
          const location = request.response.headers.get("location");
          if (!location) throw new WebFetchError("WEB_REDIRECT_BLOCKED", "重定向缺少 Location。");
          const target = resolveRedirect(location, current, this.config.allowedHosts, allowedUrls);
          if (!isSameOrigin(target, current)) throw new WebFetchError("WEB_REDIRECT_BLOCKED", "不允许跨源重定向。");
          await request.response.body?.cancel();
          current = target;
          redirects++;
          continue;
        }
        return await this.readBody(request.response, requestedUrl, current, signal);
      } finally {
        await request.close();
      }
    }
  }

  private async readBody(response: Response, requestedUrl: string, finalUrl: URL, signal: AbortSignal): Promise<WebFetchResult> {
    const contentType = response.headers.get("content-type") ?? "";
    const kind = classifyContentType(contentType);
    if (!kind) { await response.body?.cancel(); throw new WebFetchError("WEB_UNSUPPORTED_CONTENT_TYPE", "不支持的响应 Content-Type。"); }
    let decoder: TextDecoder;
    try { decoder = decoderForCharset(parseCharset(contentType)); } catch (error) { await response.body?.cancel(); throw error; }
    const { bytes, truncated } = await this.readCapped(response, signal);
    const decoded = decoder.decode(bytes);
    const charTruncated = decoded.length > this.config.maxBodyChars;
    return { requestedUrl, finalUrl: finalUrl.toString(), statusCode: response.status, contentType, body: { kind, content: charTruncated ? decoded.slice(0, this.config.maxBodyChars) : decoded }, bytesRead: bytes.byteLength, truncated: truncated || charTruncated };
  }

  private async readCapped(response: Response, signal: AbortSignal): Promise<{ readonly bytes: Uint8Array; readonly truncated: boolean }> {
    const declared = response.headers.get("content-length");
    if (declared !== null && Number.isFinite(Number(declared)) && Number(declared) > this.config.maxResponseBytes) { await response.body?.cancel(); throw new WebFetchError("WEB_FETCH_TOO_LARGE", "响应超过字节上限。"); }
    if (!response.body) return { bytes: new Uint8Array(), truncated: false };
    const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    try {
      for (;;) {
        if (signal.aborted) throw new WebFetchError("TURN_CANCELLED", "当前回合已取消。");
        const next = await reader.read();
        if (next.done) break;
        const remaining = this.config.maxResponseBytes - total;
        if (next.value.byteLength > remaining) { chunks.push(next.value.subarray(0, Math.max(0, remaining))); total += Math.max(0, remaining); truncated = true; break; }
        chunks.push(next.value); total += next.value.byteLength;
      }
    } catch (error) {
      if (error instanceof WebFetchError) throw error;
      if (signal.aborted) throw new WebFetchError("TURN_CANCELLED", "当前回合已取消。", error);
      throw new WebFetchError("WEB_NETWORK_ERROR", "读取响应失败。", error);
    } finally { await reader.cancel().catch(() => undefined); }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { bytes, truncated };
  }
}

function isRedirectStatus(status: number): boolean { return status === 301 || status === 302 || status === 303 || status === 307 || status === 308; }

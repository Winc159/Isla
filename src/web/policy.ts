import { isIP } from "node:net";
import { WebFetchError } from "./errors.js";

export const WEB_FETCH_MAX_URL_LENGTH = 2048;
export type FetchableKind = "html" | "text";

export function validateFetchUrl(input: string, allowedHosts: readonly string[]): URL {
  if (input.length === 0 || input.length > WEB_FETCH_MAX_URL_LENGTH) throw new WebFetchError("WEB_INVALID_URL", "URL 长度无效。");
  let url: URL;
  try { url = new URL(input); } catch (error) { throw new WebFetchError("WEB_INVALID_URL", "URL 格式无效。", error); }
  if (url.protocol !== "https:") throw new WebFetchError("WEB_INVALID_URL", "只允许 HTTPS URL。");
  if (url.username || url.password) throw new WebFetchError("WEB_BLOCKED_URL", "URL 不允许包含凭据。");
  if (isIP(url.hostname) !== 0) throw new WebFetchError("WEB_BLOCKED_URL", "不允许使用 IP literal。");
  if (!allowedHosts.includes(url.hostname.toLowerCase())) throw new WebFetchError("WEB_HOST_NOT_ALLOWED", "目标 hostname 不在 allowlist 中。");
  url.hash = "";
  return url;
}

export function isSameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port;
}

export function resolveRedirect(location: string, base: URL, allowedHosts: readonly string[]): URL {
  let target: URL;
  try { target = new URL(location, base); } catch (error) { throw new WebFetchError("WEB_REDIRECT_BLOCKED", "重定向目标无效。", error); }
  const validated = validateFetchUrl(target.toString(), allowedHosts);
  if (!isSameOrigin(validated, base)) throw new WebFetchError("WEB_REDIRECT_BLOCKED", "不允许跨源重定向。");
  return validated;
}

export function classifyContentType(contentType: string | null): FetchableKind | undefined {
  const mime = (contentType ?? "").replace(/;.*$/s, "").trim().toLowerCase();
  if (mime === "text/html" || mime === "application/xhtml+xml") return "html";
  if (mime.startsWith("text/") || mime === "application/json" || mime === "application/xml" || mime.endsWith("+json") || mime.endsWith("+xml")) return "text";
  return undefined;
}

export function parseCharset(contentType: string | null): string | undefined {
  return /;\s*charset\s*=\s*"?([^";]+)"?/i.exec(contentType ?? "")?.[1]?.trim().toLowerCase();
}

export function decoderForCharset(charset: string | undefined): TextDecoder {
  try { return new TextDecoder(charset ?? "utf-8"); } catch (error) { throw new WebFetchError("WEB_UNSUPPORTED_CONTENT_TYPE", `不支持的 charset：${charset ?? "unknown"}。`, error); }
}

export type WebFetchBody =
  | { readonly kind: "html"; readonly content: string }
  | { readonly kind: "text"; readonly content: string };

export interface WebFetchRequest { readonly url: string; }

export interface WebFetchResult {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly statusCode: number;
  readonly contentType: string;
  readonly body: WebFetchBody;
  readonly bytesRead: number;
  readonly truncated: boolean;
}

export type WebFetchErrorCode =
  | "WEB_INVALID_URL"
  | "WEB_HOST_NOT_ALLOWED"
  | "WEB_BLOCKED_URL"
  | "WEB_REDIRECT_BLOCKED"
  | "WEB_FETCH_TOO_LARGE"
  | "WEB_UNSUPPORTED_CONTENT_TYPE"
  | "WEB_FETCH_TIMEOUT"
  | "WEB_NETWORK_ERROR"
  | "TURN_CANCELLED";

export interface WebFetchConfigLike {
  readonly allowedHosts: readonly string[];
  readonly maxBodyChars: number;
  readonly maxOutputChars: number;
}

export interface WebSearchRequest {
  readonly query: string;
  readonly maxResults: number;
}

export interface WebSearchSource {
  readonly url: string;
  readonly title?: string;
  readonly snippet?: string;
  readonly publishedAt?: string;
}

export interface WebSearchResult {
  readonly content?: string;
  readonly sources: readonly WebSearchSource[];
  readonly truncated: boolean;
}

export interface WebSearchProvider {
  readonly id: string;
  search(request: WebSearchRequest, options?: { readonly signal?: AbortSignal }): Promise<WebSearchResult>;
}

export type WebSearchErrorCode =
  | "WEB_SEARCH_INVALID_QUERY"
  | "WEB_SEARCH_UNAVAILABLE"
  | "WEB_SEARCH_TIMEOUT"
  | "WEB_SEARCH_RATE_LIMITED"
  | "WEB_SEARCH_RESPONSE_INVALID"
  | "WEB_SEARCH_NETWORK_ERROR"
  | "TURN_CANCELLED";

const MAX_SEARCH_QUERY_CHARS = 2_000;
const MAX_SEARCH_RESULTS = 20;
const MAX_SOURCE_FIELD_CHARS = 4_000;
const MAX_SEARCH_CONTENT_CHARS = 12_000;

export function normalizeWebSearchResult(result: WebSearchResult, maxResults: number): WebSearchResult {
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > MAX_SEARCH_RESULTS) {
    throw new Error("maxResults must be between 1 and 20");
  }
  const seen = new Set<string>();
  const sources: WebSearchSource[] = [];
  let truncated = result.truncated;
  for (const source of result.sources) {
    let url: URL;
    try { url = new URL(source.url); } catch { truncated = true; continue; }
    if (url.protocol !== "https:" || url.username || url.password) { truncated = true; continue; }
    url.hash = "";
    const normalizedUrl = url.toString();
    if (seen.has(normalizedUrl)) { truncated = true; continue; }
    seen.add(normalizedUrl);
    if (sources.length >= maxResults) { truncated = true; continue; }
    sources.push({
      url: normalizedUrl,
      ...(source.title === undefined ? {} : { title: source.title.slice(0, MAX_SOURCE_FIELD_CHARS) }),
      ...(source.snippet === undefined ? {} : { snippet: source.snippet.slice(0, MAX_SOURCE_FIELD_CHARS) }),
      ...(source.publishedAt === undefined ? {} : { publishedAt: source.publishedAt.slice(0, 128) }),
    });
  }
  return {
    ...(result.content === undefined ? {} : { content: result.content.slice(0, MAX_SEARCH_CONTENT_CHARS) }),
    sources,
    truncated,
  };
}

export function validateWebSearchRequest(request: WebSearchRequest): void {
  if (request.query.trim().length === 0 || request.query.length > MAX_SEARCH_QUERY_CHARS) throw new Error("query must be non-empty and at most 2000 characters");
  if (!Number.isInteger(request.maxResults) || request.maxResults < 1 || request.maxResults > MAX_SEARCH_RESULTS) throw new Error("maxResults must be between 1 and 20");
}

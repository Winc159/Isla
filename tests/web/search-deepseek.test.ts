import { describe, expect, it } from "vitest";
import { createDeepSeekSearchProvider } from "../../src/web/search-deepseek.js";

const options = { apiKey: "test-key", model: "search-model", endpoint: "https://search.test/messages", timeoutMs: 30 } as const;
function response(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }

describe("DeepSeek search provider", () => {
  it("maps structured search blocks and sends only provider-private request fields", async () => {
    let received: RequestInit | undefined;
    const provider = createDeepSeekSearchProvider({ ...options, fetch: async (_url, init) => { received = init; return response({ content: [{ type: "web_search_tool_result", content: [{ url: "https://example.com/a", title: "A", snippet: "summary" }] }] }); } });
    await expect(provider.search({ query: "current facts", maxResults: 8 })).resolves.toMatchObject({ sources: [{ url: "https://example.com/a", title: "A", snippet: "summary" }], truncated: false });
    expect(received?.method).toBe("POST");
    expect(received?.headers).toMatchObject({ "x-api-key": "test-key", "anthropic-version": "2023-06-01" });
    expect(String(received?.body)).toContain("web_search_20250305");
  });

  it("accepts URL-only sources and rejects prose-only responses", async () => {
    const provider = createDeepSeekSearchProvider({ ...options, fetch: async () => response({ content: [{ type: "web_search_tool_result", content: [{ url: "https://example.com" }] }] }) });
    await expect(provider.search({ query: "x", maxResults: 8 })).resolves.toMatchObject({ sources: [{ url: "https://example.com/" }] });
    const invalid = createDeepSeekSearchProvider({ ...options, fetch: async () => response({ content: [{ type: "text", text: "https://example.com" }] }) });
    await expect(invalid.search({ query: "x", maxResults: 8 })).rejects.toMatchObject({ code: "WEB_SEARCH_RESPONSE_INVALID" });
  });

  it("maps rate limit and auth failures without exposing response bodies", async () => {
    const limited = createDeepSeekSearchProvider({ ...options, fetch: async () => response({ secret: "hidden" }, 429) });
    await expect(limited.search({ query: "x", maxResults: 8 })).rejects.toMatchObject({ code: "WEB_SEARCH_RATE_LIMITED" });
    const unauthorized = createDeepSeekSearchProvider({ ...options, fetch: async () => response({ secret: "hidden" }, 401) });
    await expect(unauthorized.search({ query: "x", maxResults: 8 })).rejects.toMatchObject({ code: "WEB_SEARCH_UNAVAILABLE" });
  });

  it("maps malformed JSON and network failures", async () => {
    const malformed = createDeepSeekSearchProvider({ ...options, fetch: async () => new Response("not-json", { status: 200 }) });
    await expect(malformed.search({ query: "x", maxResults: 8 })).rejects.toMatchObject({ code: "WEB_SEARCH_RESPONSE_INVALID" });
    const failed = createDeepSeekSearchProvider({ ...options, fetch: async () => { throw new Error("socket"); } });
    await expect(failed.search({ query: "x", maxResults: 8 })).rejects.toMatchObject({ code: "WEB_SEARCH_NETWORK_ERROR" });
  });

  it("distinguishes turn cancellation from timeout", async () => {
    const controller = new AbortController();
    const provider = createDeepSeekSearchProvider({ ...options, timeoutMs: 100, fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })) });
    const pending = provider.search({ query: "x", maxResults: 8 }, { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "TURN_CANCELLED" });
    const timeoutProvider = createDeepSeekSearchProvider({ ...options, timeoutMs: 1, fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })) });
    await expect(timeoutProvider.search({ query: "x", maxResults: 8 })).rejects.toMatchObject({ code: "WEB_SEARCH_TIMEOUT" });
  });
});

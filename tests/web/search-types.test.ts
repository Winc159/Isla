import { describe, expect, it } from "vitest";
import { normalizeWebSearchResult, validateWebSearchRequest, type WebSearchResult } from "../../src/web/types.js";

describe("web search contract", () => {
  it("validates one bounded non-empty query", () => {
    expect(() => validateWebSearchRequest({ query: "   ", maxResults: 8 })).toThrow("query");
    expect(() => validateWebSearchRequest({ query: "x", maxResults: 0 })).toThrow("maxResults");
    expect(() => validateWebSearchRequest({ query: "x", maxResults: 21 })).toThrow("maxResults");
    expect(() => validateWebSearchRequest({ query: "x", maxResults: 8 })).not.toThrow();
  });

  it("normalizes sources, removes fragments, deduplicates and enforces the result cap", () => {
    const result: WebSearchResult = {
      content: "answer",
      truncated: false,
      sources: [
        { url: "https://example.com/a#one", title: "A" },
        { url: "https://example.com/a#two", snippet: "duplicate" },
        { url: "http://example.com/insecure", title: "drop" },
        { url: "https://example.com/b", snippet: "B" },
      ],
    };
    expect(normalizeWebSearchResult(result, 1)).toEqual({
      content: "answer",
      truncated: true,
      sources: [{ url: "https://example.com/a", title: "A" }],
    });
  });

  it("keeps optional fields optional and bounds text", () => {
    const output = normalizeWebSearchResult({
      sources: [{ url: "https://example.com", title: "t".repeat(5_000), publishedAt: "p".repeat(200) }],
      truncated: false,
    }, 8);
    expect(output.sources[0]).toMatchObject({ url: "https://example.com/", title: "t".repeat(4_000) });
    expect(output.sources[0]).not.toHaveProperty("snippet");
    expect(output.sources[0]?.publishedAt).toHaveLength(128);
  });

  it("allows an empty result without treating it as a failure", () => {
    expect(normalizeWebSearchResult({ sources: [], truncated: false }, 8)).toEqual({ sources: [], truncated: false });
  });
});

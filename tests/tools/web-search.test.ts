import { describe, expect, it } from "vitest";
import { createWebSearchTool, renderWebSearchResult } from "../../src/tools/web-search.js";
import type { WebSearchProvider, WebSearchResult } from "../../src/web/types.js";

const result: WebSearchResult = { content: "summary", truncated: false, sources: [{ url: "https://example.com/a", title: "Example", snippet: "A result" }] };
const provider: WebSearchProvider = { id: "fake", async search() { return result; } };

describe("web_search tool boundary", () => {
  it("exposes only query and network permission", () => {
    const tool = createWebSearchTool(provider, { maxResults: 8, maxOutputChars: 1_000 });
    expect(tool.permission).toEqual({ kind: "network" });
    expect(tool.definition.parameters).toMatchObject({ required: ["query"], additionalProperties: false });
    expect(tool.definition.parameters).not.toHaveProperty("properties.maxResults");
  });

  it("rejects malformed arguments before provider execution", async () => {
    let calls = 0;
    const tool = createWebSearchTool({ id: "fake", async search() { calls++; return result; } }, { maxResults: 8, maxOutputChars: 1_000 });
    await expect(tool.execute("{}" )).rejects.toThrow("query");
    await expect(tool.execute(JSON.stringify({ query: "x", maxResults: 1 }))).rejects.toThrow("only");
    await expect(tool.execute(JSON.stringify({ query: "   " }))).rejects.toThrow("query");
    expect(calls).toBe(0);
  });

  it("passes signal and returns bounded structured details", async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const tool = createWebSearchTool({ id: "fake", async search(_request, options) { received = options?.signal; return result; } }, { maxResults: 8, maxOutputChars: 1_000 });
    const output = await tool.execute(JSON.stringify({ query: "current facts" }), { signal: controller.signal });
    expect(received).toBe(controller.signal);
    expect(output).toMatchObject({ details: { type: "web_search", provider: "fake", query: "current facts", truncated: false, hasProviderContent: true } });
    expect((output as { content: string }).content).toContain("不可信参考资料");
    expect((output as { content: string }).content).toContain("https://example.com/a");
  });

  it("bounds presentation output", () => {
    const rendered = renderWebSearchResult({ ...result, content: "0123456789" }, 100);
    expect(rendered.truncated).toBe(true);
    expect(rendered.content).toContain("搜索展示内容已截断");
    expect(rendered.content.length).toBeLessThanOrEqual(100);
  });
});

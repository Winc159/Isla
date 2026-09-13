import { describe, expect, it } from "vitest";
import { createWebFetchTool, renderWebFetchResult } from "../../src/tools/web-fetch.js";
import type { WebFetchResult } from "../../src/web/types.js";

const config = { allowedHosts: ["docs.example.com"], maxBodyChars: 60_000, maxOutputChars: 500 } as const;
const result: WebFetchResult = { requestedUrl: "https://docs.example.com/page", finalUrl: "https://docs.example.com/page", statusCode: 200, contentType: "text/html", body: { kind: "html", content: "<h1>Hello</h1><p>World</p><script>alert('x')</script>" }, bytesRead: 55, truncated: false };

describe("web_fetch tool boundary", () => {
  it("exposes only url and creates a network-permission tool", () => {
    const tool = createWebFetchTool({ fetch: async () => result }, config);
    expect(tool.permission).toEqual({ kind: "network" });
    expect(tool.definition.parameters).toMatchObject({ required: ["url"], additionalProperties: false });
    expect(tool.definition.parameters).not.toHaveProperty("properties.timeoutMs");
  });

  it("rejects malformed arguments and validates allowlist before execution", async () => {
    let calls = 0;
    const tool = createWebFetchTool({ fetch: async () => { calls++; return result; } }, config);
    await expect(tool.execute("{}" )).rejects.toThrow("url");
    await expect(tool.execute(JSON.stringify({ url: "https://other.example.com/x" }))).rejects.toThrow("allowlist");
    await expect(tool.execute(JSON.stringify({ url: "https://docs.example.com/x", timeoutMs: 1 }))).rejects.toThrow("only");
    expect(calls).toBe(0);
  });

  it("passes the signal and returns bounded structured details", async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const tool = createWebFetchTool({ fetch: async (_request, options) => { received = options?.signal; return result; } }, config);
    const output = await tool.execute(JSON.stringify({ url: "https://docs.example.com/page#fragment" }), { signal: controller.signal });
    expect(received).toBe(controller.signal);
    expect(output).toMatchObject({ details: { type: "web_fetch", statusCode: 200, bodyKind: "html", truncated: false } });
    expect((output as { content: string }).content).toContain("不可信参考资料");
    expect((output as { content: string }).content).toContain("# Hello");
  });

  it("redacts query values and fragments from approval summaries", () => {
    const tool = createWebFetchTool({ fetch: async () => result }, config);
    const summary = tool.describe(JSON.stringify({ url: "https://docs.example.com/search?q=secret-token&lang=en#private" }));
    expect(summary).toContain("/search");
    expect(summary).toContain("?…");
    expect(summary).not.toContain("secret-token");
    expect(summary).not.toContain("private");
  });

  it("bounds presentation output and marks presentation truncation", () => {
    const rendered = renderWebFetchResult({ ...result, body: { kind: "text", content: "0123456789" } }, 100);
    expect(rendered.truncated).toBe(true);
    expect(rendered.content).toContain("展示内容已截断");
    expect(rendered.content.length).toBeLessThanOrEqual(100);
  });
});

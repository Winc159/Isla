import { describe, expect, it } from "vitest";
import { Response } from "undici";
import { HttpFetchProvider } from "../../src/web/fetch.js";
import type { PinnedResponse } from "../../src/web/transport.js";

const config = { allowedHosts: ["docs.example.com"], timeoutMs: 1000, maxResponseBytes: 5, maxBodyChars: 100, maxOutputChars: 100, maxRedirects: 2, userAgent: "Isla/test" } as const;
const address = [{ address: "93.184.216.34", family: 4 as const }];

describe("web HTTP fetch provider", () => {
  it("returns bounded text and preserves non-2xx status", async () => {
    const provider = new HttpFetchProvider(config, { resolveAddresses: async () => address, requestPinned: async () => pinned(new Response("hello", { status: 404, headers: { "content-type": "text/plain" } })) });
    await expect(provider.fetch({ url: "https://docs.example.com/page#fragment" })).resolves.toMatchObject({ requestedUrl: "https://docs.example.com/page", finalUrl: "https://docs.example.com/page", statusCode: 404, body: { kind: "text", content: "hello" }, bytesRead: 5, truncated: false });
  });

  it("follows same-origin redirects and re-resolves every hop", async () => {
    const urls: string[] = [];
    let step = 0;
    const provider = new HttpFetchProvider(config, { resolveAddresses: async hostname => { urls.push(hostname); return address; }, requestPinned: async url => { step++; return pinned(step === 1 ? new Response(null, { status: 302, headers: { location: "/next" } }) : new Response("ok", { headers: { "content-type": "text/plain" } })); } });
    await expect(provider.fetch({ url: "https://docs.example.com/start" })).resolves.toMatchObject({ finalUrl: "https://docs.example.com/next", body: { content: "ok" } });
    expect(urls).toEqual(["docs.example.com", "docs.example.com"]);
  });

  it("blocks cross-origin redirects before requesting the target", async () => {
    let calls = 0;
    const provider = new HttpFetchProvider({ ...config, allowedHosts: ["docs.example.com", "other.example.com"] }, { resolveAddresses: async () => address, requestPinned: async () => { calls++; return pinned(new Response(null, { status: 302, headers: { location: "https://other.example.com/x" } })); } });
    await expect(provider.fetch({ url: "https://docs.example.com/start" })).rejects.toThrow("跨源");
    expect(calls).toBe(1);
  });

  it("rejects declared oversized responses and truncates streamed bodies", async () => {
    const oversized = new HttpFetchProvider(config, { resolveAddresses: async () => address, requestPinned: async () => pinned(new Response("123456", { headers: { "content-type": "text/plain", "content-length": "6" } })) });
    await expect(oversized.fetch({ url: "https://docs.example.com/x" })).rejects.toThrow("字节");
    const streamed = new HttpFetchProvider(config, { resolveAddresses: async () => address, requestPinned: async () => pinned(new Response("123456", { headers: { "content-type": "text/plain" } })) });
    await expect(streamed.fetch({ url: "https://docs.example.com/x" })).resolves.toMatchObject({ body: { content: "12345" }, bytesRead: 5, truncated: true });
  });

  it("distinguishes provider timeout from Turn cancellation", async () => {
    const slow = new HttpFetchProvider({ ...config, timeoutMs: 1 }, { resolveAddresses: async () => address, requestPinned: async (_url, _addresses, _headers, signal) => { if (signal.aborted) throw new Error("aborted"); await new Promise<void>((resolve, reject) => { signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); }); throw new Error("unreachable"); } });
    await expect(slow.fetch({ url: "https://docs.example.com/x" })).rejects.toMatchObject({ code: "WEB_FETCH_TIMEOUT" });
    const controller = new AbortController();
    const cancelled = new HttpFetchProvider(config, { resolveAddresses: async () => address, requestPinned: async (_url, _addresses, _headers, signal) => { if (signal.aborted) throw new Error("aborted"); await new Promise<void>((resolve, reject) => { signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); }); throw new Error("unreachable"); } });
    const pending = cancelled.fetch({ url: "https://docs.example.com/x" }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "TURN_CANCELLED" });
  });
});

function pinned(response: Response): PinnedResponse { return { response, close: async () => undefined }; }

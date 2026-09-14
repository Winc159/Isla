import { describe, expect, it } from "vitest";
import { classifyContentType, decoderForCharset, isSameOrigin, resolveRedirect, validateFetchUrl } from "../../src/web/policy.js";

describe("web fetch policy", () => {
  const hosts = ["docs.example.com"];

  it("accepts only allowlisted HTTPS URLs and removes fragments", () => {
    expect(validateFetchUrl("https://docs.example.com/a?q=1#secret", hosts).toString()).toBe("https://docs.example.com/a?q=1");
    expect(() => validateFetchUrl("http://docs.example.com/a", hosts)).toThrow("HTTPS");
    expect(() => validateFetchUrl("https://other.example.com/a", hosts)).toThrow("allowlist");
    expect(() => validateFetchUrl("https://127.0.0.1/a", hosts)).toThrow("IP");
    expect(() => validateFetchUrl("https://user:pass@docs.example.com/a", hosts)).toThrow("凭据");
  });

  it("allows only an exact temporary search URL when supplied", () => {
    const source = "https://search.example.com/article?id=1";
    expect(validateFetchUrl(`${source}#section`, hosts, [source]).toString()).toBe(source);
    expect(() => validateFetchUrl("https://search.example.com/other", hosts, [source])).toThrow("allowlist");
    expect(() => validateFetchUrl("https://search.example.com/article?id=2", hosts, [source])).toThrow("allowlist");
  });

  it("allows same-origin redirects and blocks cross-origin redirects", () => {
    const base = new URL("https://docs.example.com/start");
    expect(resolveRedirect("/next", base, hosts).toString()).toBe("https://docs.example.com/next");
    expect(() => resolveRedirect("https://other.example.com/next", base, [...hosts, "other.example.com"])).toThrow("跨源");
    expect(() => resolveRedirect("http://docs.example.com/next", base, hosts)).toThrow("HTTPS");
    expect(isSameOrigin(base, new URL("https://docs.example.com:443/start"))).toBe(true);
  });

  it("classifies only textual response types", () => {
    expect(classifyContentType("text/html; charset=utf-8")).toBe("html");
    expect(classifyContentType("application/json")).toBe("text");
    expect(classifyContentType("application/vnd.example+json")).toBe("text");
    expect(classifyContentType("application/octet-stream")).toBeUndefined();
    expect(classifyContentType(null)).toBeUndefined();
  });

  it("decodes declared charset and rejects unknown charset", () => {
    expect(decoderForCharset("utf-8").decode(new Uint8Array([0xE4, 0xB8, 0xAD]))).toBe("中");
    expect(() => decoderForCharset("not-a-real-charset")).toThrow("charset");
  });
});

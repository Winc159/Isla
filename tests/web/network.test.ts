import { describe, expect, it } from "vitest";
import { isNonPublicIpLiteral, isPublicIpAddress, resolvePublicAddresses } from "../../src/web/network.js";

describe("web public network policy", () => {
  it("classifies public and private IPv4/IPv6 including mapped addresses", () => {
    expect(isPublicIpAddress("93.184.216.34")).toBe(true);
    expect(isPublicIpAddress("127.0.0.1")).toBe(false);
    expect(isPublicIpAddress("192.168.1.1")).toBe(false);
    expect(isPublicIpAddress("2001:4860:4860::8888")).toBe(true);
    expect(isPublicIpAddress("::1")).toBe(false);
    expect(isPublicIpAddress("::ffff:93.184.216.34")).toBe(true);
    expect(isPublicIpAddress("::ffff:192.168.1.1")).toBe(false);
    expect(isNonPublicIpLiteral("[::1]")).toBe(true);
  });

  it("fails closed when any DNS answer is non-public", async () => {
    const signal = new AbortController().signal;
    await expect(resolvePublicAddresses("mixed.example", signal, async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ])).rejects.toThrow("非公网");
  });

  it("returns the complete validated public answer set", async () => {
    const signal = new AbortController().signal;
    await expect(resolvePublicAddresses("public.example", signal, async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "2001:4860:4860::8888", family: 6 },
    ])).resolves.toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2001:4860:4860::8888", family: 6 },
    ]);
  });

  it("blocks a DNS64 address that embeds a private IPv4 destination", async () => {
    const signal = new AbortController().signal;
    const resolver = async (hostname: string) => hostname === "ipv4only.arpa"
      ? [{ address: "64:ff9b::c000:aa", family: 6 as const }, { address: "64:ff9b::c000:ab", family: 6 as const }]
      : [{ address: "64:ff9b::a00:1", family: 6 as const }];
    await expect(resolvePublicAddresses("nat64.example", signal, resolver)).rejects.toThrow("非公网");
  });

  it("does not call DNS after pre-cancel and settles an in-flight lookup", async () => {
    const controller = new AbortController();
    let calls = 0;
    const pending = resolvePublicAddresses("cancel.example", controller.signal, async () => { calls++; return await new Promise(() => undefined); });
    controller.abort();
    await expect(pending).rejects.toThrow("取消");
    expect(calls).toBe(1);
    const preCancelled = new AbortController();
    preCancelled.abort();
    calls = 0;
    await expect(resolvePublicAddresses("cancel.example", preCancelled.signal, async () => { calls++; return []; })).rejects.toThrow("取消");
    expect(calls).toBe(0);
  });
});

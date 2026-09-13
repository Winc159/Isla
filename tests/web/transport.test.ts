import { describe, expect, it } from "vitest";
import { createPinnedLookup, requestPinned } from "../../src/web/transport.js";

describe("web pinned transport", () => {
  it("only returns the previously validated addresses", () => {
    const lookup = createPinnedLookup([{ address: "93.184.216.34", family: 4 }, { address: "2001:4860:4860::8888", family: 6 }]);
    const all = awaitLookup(lookup, "docs.example.com", { all: true, family: 0 });
    expect(all.error).toBeNull();
    expect(all.address).toEqual([{ address: "93.184.216.34", family: 4 }, { address: "2001:4860:4860::8888", family: 6 }]);
    expect(awaitLookup(lookup, "docs.example.com", { all: false, family: 4 }).address).toBe("93.184.216.34");
    expect(awaitLookup(lookup, "docs.example.com", { all: false, family: 6 }).address).toBe("2001:4860:4860::8888");
    expect(awaitLookup(lookup, "docs.example.com", { all: false, family: 5 }).error).toMatchObject({ code: "ENOTFOUND" });
  });

  it("uses GET/manual redirect, forwards headers and signal, and closes on success", async () => {
    const controller = new AbortController();
    let request: Record<string, unknown> | undefined;
    let closed = 0;
    const response = { status: 200 } as Response;
    const result = await requestPinned(new URL("https://docs.example.com/a"), [{ address: "93.184.216.34", family: 4 }], { "user-agent": "Isla/test" }, controller.signal, {
      createAgent: () => ({ dispatcher: {} as never, close: async () => { closed++; } }),
      fetch: async (_url, init) => { request = init as Record<string, unknown>; return response; },
    });
    expect(result.response).toBe(response);
    expect(request).toMatchObject({ method: "GET", redirect: "manual", headers: { "user-agent": "Isla/test" }, signal: controller.signal });
    await result.close();
    expect(closed).toBe(1);
  });

  it("closes the dispatcher when fetch fails", async () => {
    let closed = 0;
    await expect(requestPinned(new URL("https://docs.example.com/a"), [{ address: "93.184.216.34", family: 4 }], {}, new AbortController().signal, {
      createAgent: () => ({ dispatcher: {} as never, close: async () => { closed++; } }),
      fetch: async () => { throw new Error("connection failed"); },
    })).rejects.toThrow("connection failed");
    expect(closed).toBe(1);
  });
});

function awaitLookup(lookup: ReturnType<typeof createPinnedLookup>, hostname: string, options: { readonly all: boolean; readonly family: number }) {
  const seen = { error: null as unknown, address: undefined as unknown };
  lookup(hostname, options as never, (error, address) => { seen.error = error; seen.address = address; });
  return seen;
}

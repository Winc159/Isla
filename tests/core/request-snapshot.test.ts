import { describe, expect, it } from "vitest";
import { createRequestSnapshot, stableSerialize, verifyRequestSnapshot } from "../../src/core/request-snapshot.js";

describe("request snapshots", () => {
  it("hashes the actual request deterministically", () => {
    const request = { messages: [{ role: "user" as const, content: "你好" }], tools: [{ name: "b", description: "b", parameters: {} }, { name: "a", description: "a", parameters: {} }] };
    const snapshot = createRequestSnapshot(request, "deepseek", "m1");
    expect(snapshot.tools?.map(tool => tool.name)).toEqual(["a", "b"]);
    expect(verifyRequestSnapshot(snapshot)).toBe(true);
    expect(createRequestSnapshot(request, "deepseek", "m1").requestHash).toBe(snapshot.requestHash);
  });

  it("detects snapshot mutation without contacting a provider", () => {
    const snapshot = createRequestSnapshot({ messages: [{ role: "user", content: "原文" }] }, "local", "m1");
    const changed = { ...snapshot, messages: [{ role: "user" as const, content: "篡改" }] };
    expect(verifyRequestSnapshot(changed)).toBe(false);
  });

  it("omits undefined fields and preserves array order", () => {
    expect(stableSerialize({ z: undefined, a: [2, 1] })).toBe('{"a":[2,1]}');
  });
});

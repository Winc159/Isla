import { describe, expect, it } from "vitest";
import { IslaRuntime } from "../../src/core/runtime.js";
import { FakeProvider } from "../support/fake-provider.js";
const plugin = (name: string, provider = new FakeProvider([{ text: "ok" }])) => ({ name, setup: (c: { registerProvider: (p: FakeProvider) => void }) => c.registerProvider(provider) });
describe("runtime", () => {
  it("installs and creates sessions", () => expect(new IslaRuntime().use(plugin("x")).createSession({ providerId: "fake" })).toBeTruthy());
  it("rejects duplicate plugin and provider", () => { const r = new IslaRuntime().use(plugin("x")); expect(() => r.use(plugin("x"))).toThrow(); expect(() => r.use(plugin("y"))).toThrow(); });
  it("rejects missing provider", () => expect(() => new IslaRuntime().createSession({ providerId: "none" })).toThrow());
});

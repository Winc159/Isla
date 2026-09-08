import { describe, expect, it } from "vitest";
import { ChatSession } from "../../src/core/session.js";
import { FakeProvider } from "../support/fake-provider.js";
describe("session", () => {
  it("maintains ordered context", async () => { const p = new FakeProvider([{ text: "a1" }, { text: "a2" }]); const s = new ChatSession(p, "system"); await s.send("u1"); await s.send("u2"); expect(p.requests[1]?.messages).toEqual([{ role: "system", content: "system" }, { role: "user", content: "u1" }, { role: "assistant", content: "a1" }, { role: "user", content: "u2" }]); });
  it("keeps failed user input", async () => { const p = new FakeProvider([new Error("no") , { text: "retry" }]); const s = new ChatSession(p); await expect(s.send("u1")).rejects.toThrow(); await s.send("retry"); expect(p.requests[1]?.messages).toEqual([{ role: "user", content: "u1" }, { role: "user", content: "retry" }]); });
});

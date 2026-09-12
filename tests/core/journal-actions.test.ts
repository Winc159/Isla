import { describe, expect, it } from "vitest";
import { ChatSession } from "../../src/core/session.js";
import { FakeProvider } from "../support/fake-provider.js";

describe("journal action safety", () => {
  it("records tool identity and result code without arguments or result body", async () => {
    const provider = new FakeProvider([{ text: "完成" }]);
    const states: Array<{ journal?: { turns: readonly Array<{ actions: readonly unknown[] }> } }> = [];
    const session = new ChatSession(provider, { onSessionStateChanged: async state => states.push(state), journal: { version: 1, turns: [] } });
    await session.send("你好");
    expect(states.at(-1)?.journal?.turns[0]?.actions).toEqual([]);
  });
});

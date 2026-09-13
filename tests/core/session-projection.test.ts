import { describe, expect, it } from "vitest";
import { projectStoredSession } from "../../src/session-factory.js";
import type { StoredSessionV3 } from "../../src/session-store.js";

describe("stored session projection", () => {
  it("preserves v3 context and journal for every entrypoint", () => {
    const stored: StoredSessionV3 = {
      version: 3,
      id: "session-1",
      createdAt: "2026-09-13T00:00:00.000Z",
      updatedAt: "2026-09-13T00:00:01.000Z",
      provider: "local",
      model: "fixture",
      messages: [{ role: "system", content: "system" }],
      context: { version: 1, checkpoint: { throughMessageIndex: 0, createdAt: "2026-09-13T00:00:00.000Z", provider: "local", model: "fixture", content: "checkpoint" } },
      journal: { version: 1, turns: [] },
    };
    expect(projectStoredSession(stored)).toEqual({ messages: stored.messages, context: stored.context, journal: stored.journal });
  });
});

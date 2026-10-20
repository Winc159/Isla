import { describe, expect, it } from "vitest";
import { buildSessionPersistenceState } from "../../src/core/session-persistence.js";
import type { Message } from "../../src/core/types.js";

describe("session persistence state", () => {
  it("copies messages and preserves every configured session fact", () => {
    const messages: Message[] = [{ role: "user", content: "hello" }];
    const context = { version: 1 as const };
    const journal = { version: 1 as const, turns: [] };
    const task = { version: 1 as const, revision: 1, goal: "goal", status: "active" as const, constraints: [], assumptions: [], openQuestions: [], steps: [], blockers: [], updatedAt: "2026-10-20T00:00:00.000Z" };
    const skillCatalog = { version: 1 as const, entries: [] };
    const capabilityActivation = { version: 1 as const, taskKey: "task", activeCapabilityIds: ["read"], updatedAt: "2026-10-20T00:00:00.000Z" };

    const state = buildSessionPersistenceState({ messages, context, journal, task, skillCatalog, capabilityActivation });

    expect(state).toEqual({ messages, context, journal, task, skillCatalog, capabilityActivation });
    expect(state.messages).not.toBe(messages);
  });

  it("omits absent optional state instead of persisting undefined fields", () => {
    const state = buildSessionPersistenceState({
      messages: [],
      context: undefined,
      journal: { version: 1, turns: [] },
      task: undefined,
      skillCatalog: undefined,
      capabilityActivation: undefined,
    });

    expect(state).toEqual({ messages: [], journal: { version: 1, turns: [] } });
    expect(state).not.toHaveProperty("context");
    expect(state).not.toHaveProperty("task");
    expect(state).not.toHaveProperty("skillCatalog");
    expect(state).not.toHaveProperty("capabilityActivation");
  });
});

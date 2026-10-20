import { describe, expect, it } from "vitest";
import { buildRequestMessageProjection } from "../../src/core/request-message-projection.js";
import type { Message } from "../../src/core/types.js";

describe("request message projection", () => {
  it("keeps system policy, injects the checkpoint, and excludes checkpointed conversation", () => {
    const messages: Message[] = [
      { role: "system", content: "system" },
      { role: "user", content: "old user" },
      { role: "assistant", content: "old assistant" },
      { role: "user", content: "current user" },
    ];

    expect(buildRequestMessageProjection(messages, {
      currentUserMessageIndex: 3,
      checkpoint: { throughMessageIndex: 2, createdAt: "2026-10-20T00:00:00.000Z", provider: "fake", model: "fixture", content: "old checkpoint" },
      maxTurns: 20,
      maxChars: 10_000,
    })).toEqual([
      messages[0],
      expect.objectContaining({ role: "user", content: expect.stringContaining("old checkpoint") }),
      messages[3],
    ]);
  });

  it("keeps only the current turn-scoped skill invocation", () => {
    const messages: Message[] = [
      { role: "user", content: "old user" },
      { role: "system", content: "old skill", source: { kind: "skill-invocation", name: "old", scope: "turn", userMessageIndex: 0 } },
      { role: "assistant", content: "old assistant" },
      { role: "user", content: "current user" },
      { role: "system", content: "current skill", source: { kind: "skill-invocation", name: "current", scope: "turn", userMessageIndex: 3 } },
    ];

    const result = buildRequestMessageProjection(messages, {
      currentUserMessageIndex: 3,
      checkpoint: undefined,
      maxTurns: 20,
      maxChars: 10_000,
    });

    expect(result).toContainEqual(messages[4]);
    expect(result).not.toContainEqual(messages[1]);
    expect(messages).toHaveLength(5);
  });

  it("applies the existing complete-turn budget without mutating history", () => {
    const messages: Message[] = [
      { role: "system", content: "system" },
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
    ];

    expect(buildRequestMessageProjection(messages, {
      currentUserMessageIndex: 3,
      checkpoint: undefined,
      maxTurns: 1,
      maxChars: 10_000,
    })).toEqual([messages[0], messages[3], messages[4]]);
    expect(messages).toHaveLength(5);
  });
});

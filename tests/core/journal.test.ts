import { describe, expect, it } from "vitest";
import { validateSessionJournal, type SessionJournal } from "../../src/core/journal.js";

const request = { provider: "fake", model: "fake", promptVersion: "prompt-v1", messages: [], retrievedSourceIds: [], requestHash: "hash" } as const;

function journal(status: SessionJournal["turns"][number]["status"], assistantMessageIndex?: number): SessionJournal {
  return { version: 1, turns: [{ id: "turn-1", sequence: 1, startedAt: "2026-01-01T00:00:00.000Z", ...(status === "completed" ? { endedAt: "2026-01-01T00:00:01.000Z" } : {}), status, userMessageIndex: 0, ...(assistantMessageIndex !== undefined ? { assistantMessageIndex } : {}), attempts: [{ attempt: 1, step: 1, startedAt: "2026-01-01T00:00:00.000Z", status: "running", request }], actions: [] }] };
}

describe("Session Journal contract", () => {
  it("accepts a running turn and a completed turn with a real assistant message", () => {
    expect(() => validateSessionJournal(journal("running"), [{ role: "user", content: "hello" }])).not.toThrow();
    expect(() => validateSessionJournal(journal("completed", 1), [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }])).not.toThrow();
  });

  it("rejects a completed turn without a non-empty assistant message", () => {
    expect(() => validateSessionJournal(journal("completed"), [{ role: "user", content: "hello" }])).toThrow("Completed Turn");
    expect(() => validateSessionJournal(journal("completed", 1), [{ role: "user", content: "hello" }, { role: "assistant", content: "" }])).toThrow("Completed Turn");
  });

  it("rejects a failed turn that fabricates an assistant message", () => {
    expect(() => validateSessionJournal(journal("failed", 1), [{ role: "user", content: "hello" }, { role: "assistant", content: "not valid" }])).toThrow("Non-completed");
  });

  it("accepts a cancelled turn without an assistant and requires a stable cancellation record", () => {
    const cancelled = journal("cancelled").turns[0]!;
    const record = { ...cancelled, endedAt: "2026-01-01T00:00:02.000Z", error: { code: "TURN_CANCELLED" as const, recoverable: false, message: "当前回合已取消。" } };
    expect(() => validateSessionJournal({ version: 1, turns: [record] }, [{ role: "user", content: "hello" }])).not.toThrow();
    expect(() => validateSessionJournal({ version: 1, turns: [{ ...record, error: { code: "INTERRUPTED" as const, recoverable: true, message: "中断" } }] }, [{ role: "user", content: "hello" }])).toThrow("TURN_CANCELLED");
  });

  it("requires endedAt for terminal turns and permits aborted attempts", () => {
    const cancelled = journal("cancelled").turns[0]!;
    const record = { ...cancelled, error: { code: "TURN_CANCELLED" as const, recoverable: false, message: "当前回合已取消。" }, attempts: [{ ...cancelled.attempts[0]!, status: "aborted" as const, endedAt: "2026-01-01T00:00:02.000Z" }] };
    expect(() => validateSessionJournal({ version: 1, turns: [record] }, [{ role: "user", content: "hello" }])).toThrow("endedAt");
    expect(() => validateSessionJournal({ version: 1, turns: [{ ...record, endedAt: "2026-01-01T00:00:02.000Z" }] }, [{ role: "user", content: "hello" }])).not.toThrow();
  });

  it("rejects non-monotonic sequences and a second running turn", () => {
    const first = journal("running").turns[0]!;
    expect(() => validateSessionJournal({ version: 1, turns: [first, { ...first, id: "turn-2", sequence: 2, userMessageIndex: 0 }] }, [{ role: "user", content: "hello" }])).toThrow("Only the latest");
    expect(() => validateSessionJournal({ version: 1, turns: [{ ...first, sequence: 2 }, { ...first, id: "turn-2", sequence: 1 }] }, [{ role: "user", content: "hello" }])).toThrow("sequence");
  });
});

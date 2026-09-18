import { describe, expect, it } from "vitest";
import { migrateTaskBrief, summarizeTaskState, TaskStateValidationError, updateTaskState, validateTaskState } from "../../src/core/task-state.js";

describe("task state", () => {
  const messages = [{ role: "user" as const, content: "完成项目" }];

  it("migrates TaskBrief and summarizes progress", () => {
    const state = migrateTaskBrief({ goal: "完成项目", confirmedConstraints: [{ text: "只改源码", sourceMessageIndex: 0 }], openQuestions: [], assumptions: [] }, messages, "now");
    expect(state).toMatchObject({ version: 1, revision: 0, status: "active", goal: "完成项目", updatedAt: "now" });
    expect(summarizeTaskState({ ...state, steps: [{ id: "s1", title: "实现", status: "completed" }] })).toMatchObject({ completedSteps: 1, totalSteps: 1 });
  });

  it("rejects invalid step invariants", () => {
    const base = migrateTaskBrief({ goal: "完成项目", confirmedConstraints: [], openQuestions: [], assumptions: [] }, messages);
    expect(() => validateTaskState({ ...base, steps: [{ id: "a", title: "A", status: "in_progress" }, { id: "b", title: "B", status: "in_progress" }] })).toThrowError(TaskStateValidationError);
    expect(() => validateTaskState({ ...base, status: "blocked" })).toThrowError(/blocked task/);
  });

  it("uses compare-and-swap revisions", () => {
    const next = { goal: "完成项目", status: "active" as const, constraints: [], assumptions: [], openQuestions: [], steps: [], blockers: [] };
    const created = updateTaskState(undefined, next, 0, messages, "t1");
    expect(created.revision).toBe(1);
    expect(() => updateTaskState(created, next, 0, messages)).toThrowError(/revision/);
    expect(updateTaskState(created, next, 1, messages, "t2").revision).toBe(2);
  });
});

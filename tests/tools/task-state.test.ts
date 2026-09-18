import { describe, expect, it } from "vitest";
import { createTaskStateCapability } from "../../src/tools/task-state.js";

describe("task-state capability", () => {
  it("returns a bounded state update for Runtime validation", async () => {
    const tool = createTaskStateCapability().tools[0]!;
    const result = await tool.execute(JSON.stringify({ goal: "完成任务", status: "active", constraints: [], assumptions: [], openQuestions: [], steps: [{ title: "实现", status: "pending" }], blockers: [] }));
    expect(result).toMatchObject({ details: { type: "task_state_update" } });
    expect(tool.definition.parameters.properties).not.toHaveProperty("expectedRevision");
    expect(tool.definition.parameters).toMatchObject({ additionalProperties: false, required: ["goal", "status", "constraints", "assumptions", "openQuestions", "steps", "blockers"] });
  });

  it("rejects malformed state", async () => {
    const tool = createTaskStateCapability().tools[0]!;
    await expect(tool.execute(JSON.stringify({ goal: "", status: "active" }))).rejects.toThrow();
  });
});

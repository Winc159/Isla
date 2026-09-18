import type { Tool, ToolCapability, ToolOutput } from "./types.js";

export function createTaskStateCapability(): ToolCapability {
  const tool: Tool = {
    definition: {
      name: "update_task_state",
      description: "记录或更新当前多步骤任务。仅在计划或进度发生实质变化时调用；简单单步任务无需调用。每次提交完整状态并替换上一状态。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["goal", "status", "constraints", "assumptions", "openQuestions", "steps", "blockers"],
        properties: {
          goal: { type: "string", description: "当前任务目标。" },
          status: { type: "string", enum: ["active", "blocked", "completed"] },
          constraints: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["text"],
              properties: {
                text: { type: "string" },
                sourceMessageIndex: { type: "integer", minimum: 0 },
              },
            },
          },
          assumptions: { type: "array", items: { type: "string" } },
          openQuestions: { type: "array", items: { type: "string" } },
          steps: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title", "status"],
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                status: { type: "string", enum: ["pending", "in_progress", "completed", "blocked"] },
              },
            },
          },
          blockers: { type: "array", items: { type: "string" } },
        },
      },
    },
    execute: async argumentsJson => {
      let input: unknown;
      try { input = JSON.parse(argumentsJson); } catch { throw new Error("update_task_state arguments must be valid JSON"); }
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("update_task_state arguments must be an object");
      const value = input as Record<string, unknown>;
      const state = value;
      if (typeof state.goal !== "string" || !state.goal.trim() || !["active", "blocked", "completed"].includes(state.status as string) || !Array.isArray(state.constraints) || !Array.isArray(state.assumptions) || !Array.isArray(state.openQuestions) || !Array.isArray(state.steps) || !Array.isArray(state.blockers)) throw new Error("update_task_state state fields are invalid");
      const output: ToolOutput = {
        content: "任务状态更新已提交，Runtime 将校验并保存。",
        details: { type: "task_state_update", state: state as never },
      };
      return output;
    },
  };
  return { id: "task-state", instructions: "多步骤或跨 Turn 任务可以用 update_task_state 记录计划和进度；简单单步任务跳过。每次提交完整状态，只有目标、步骤、约束或阻塞发生实质变化时才更新，不要为每个 Tool Call 机械更新。completed 只能在任务确实完成时使用。", tools: [tool] };
}

import type { TaskBrief } from "./agent-loop.js";
import type { Message } from "./types.js";

export type TaskStatus = "active" | "blocked" | "completed";
export type TaskStepStatus = "pending" | "in_progress" | "completed" | "blocked";

export interface TaskConstraint {
  readonly text: string;
  readonly sourceMessageIndex?: number;
}

export interface TaskStep {
  readonly id: string;
  readonly title: string;
  readonly status: TaskStepStatus;
}

export interface TaskStateV1 {
  readonly version: 1;
  readonly revision: number;
  readonly goal: string;
  readonly status: TaskStatus;
  readonly constraints: readonly TaskConstraint[];
  readonly assumptions: readonly string[];
  readonly openQuestions: readonly string[];
  readonly steps: readonly TaskStep[];
  readonly blockers: readonly string[];
  readonly updatedAt: string;
}

export interface TaskStateSummary {
  readonly status: TaskStatus;
  readonly goal: string;
  readonly completedSteps: number;
  readonly totalSteps: number;
  readonly blockerCount: number;
  readonly openQuestionCount: number;
}

export type TaskStateValidationCode = "TASK_STATE_INVALID" | "TASK_STATE_CONFLICT" | "TASK_STATE_TOO_LARGE" | "TASK_STATE_STALE";

export class TaskStateValidationError extends Error {
  readonly code: TaskStateValidationCode;
  constructor(code: TaskStateValidationCode, message: string) {
    super(message);
    this.name = "TaskStateValidationError";
    this.code = code;
  }
}

const MAX_ITEMS = 32;
const MAX_ITEM_CHARS = 1000;
const MAX_GOAL_CHARS = 1000;

export function validateTaskState(state: TaskStateV1, messages?: readonly Message[]): TaskStateV1 {
  if (!Number.isInteger(state.revision) || state.revision < 0) invalid("task.revision 无效");
  assertText(state.goal, "task.goal", MAX_GOAL_CHARS);
  if (state.status !== "active" && state.status !== "blocked" && state.status !== "completed") invalid("task.status 无效");
  if (state.constraints.length > MAX_ITEMS || state.assumptions.length > MAX_ITEMS || state.openQuestions.length > MAX_ITEMS || state.steps.length > MAX_ITEMS || state.blockers.length > MAX_ITEMS)
    tooLarge("task 项目数量超出限制");
  for (const constraint of state.constraints) {
    assertText(constraint.text, "task.constraints.text", MAX_ITEM_CHARS);
    if (constraint.sourceMessageIndex !== undefined && (!Number.isInteger(constraint.sourceMessageIndex) || constraint.sourceMessageIndex < 0 || (messages && (constraint.sourceMessageIndex >= messages.length || messages[constraint.sourceMessageIndex]?.role !== "user")))) invalid("task.constraints.sourceMessageIndex 无效");
  }
  state.assumptions.forEach(item => assertText(item, "task.assumptions", MAX_ITEM_CHARS));
  state.openQuestions.forEach(item => assertText(item, "task.openQuestions", MAX_ITEM_CHARS));
  state.blockers.forEach(item => assertText(item, "task.blockers", MAX_ITEM_CHARS));
  const ids = new Set<string>();
  let inProgress = 0;
  let incomplete = 0;
  for (const step of state.steps) {
    assertText(step.id, "task.steps.id", 128);
    assertText(step.title, "task.steps.title", MAX_ITEM_CHARS);
    if (ids.has(step.id)) invalid("task.steps.id 重复");
    ids.add(step.id);
    if (!["pending", "in_progress", "completed", "blocked"].includes(step.status)) invalid("task.steps.status 无效");
    if (step.status === "in_progress") inProgress += 1;
    if (step.status !== "completed") incomplete += 1;
  }
  if (inProgress > 1) conflict("task 同时只能有一个 in_progress step");
  if (state.status === "completed" && (incomplete > 0 || state.blockers.length > 0 || state.openQuestions.length > 0)) conflict("completed task 不能包含未完成事项");
  if (state.status === "blocked" && state.blockers.length === 0 && state.openQuestions.length === 0) conflict("blocked task 必须包含 blocker 或 openQuestion");
  return state;
}

export function migrateTaskBrief(task: TaskBrief, messages: readonly Message[], now = new Date().toISOString()): TaskStateV1 {
  const state: TaskStateV1 = {
    version: 1,
    revision: 0,
    goal: task.goal,
    status: "active",
    constraints: task.confirmedConstraints.map(constraint => ({ text: constraint.text, sourceMessageIndex: constraint.sourceMessageIndex })),
    assumptions: [...task.assumptions],
    openQuestions: [...task.openQuestions],
    steps: [],
    blockers: [],
    updatedAt: now,
  };
  return validateTaskState(state, messages);
}

export function summarizeTaskState(state: TaskStateV1): TaskStateSummary {
  return {
    status: state.status,
    goal: state.goal,
    completedSteps: state.steps.filter(step => step.status === "completed").length,
    totalSteps: state.steps.length,
    blockerCount: state.blockers.length,
    openQuestionCount: state.openQuestions.length,
  };
}

export function updateTaskState(current: TaskStateV1 | undefined, next: Omit<TaskStateV1, "version" | "revision" | "updatedAt">, expectedRevision: number, messages?: readonly Message[], now = new Date().toISOString()): TaskStateV1 {
  if (current && current.revision !== expectedRevision) throw new TaskStateValidationError("TASK_STATE_STALE", "TaskState revision 已变化，请基于最新状态重试");
  if (!current && expectedRevision !== 0) throw new TaskStateValidationError("TASK_STATE_STALE", "新 TaskState 的 expectedRevision 必须为 0");
  const state: TaskStateV1 = { version: 1, revision: (current?.revision ?? 0) + 1, ...next, updatedAt: now };
  return validateTaskState(state, messages);
}

function assertText(value: string, field: string, max: number): void {
  if (typeof value !== "string" || !value.trim()) invalid(`${field} 必须是非空字符串`);
  if (value.length > max) tooLarge(`${field} 超出长度限制`);
}

function invalid(message: string): never { throw new TaskStateValidationError("TASK_STATE_INVALID", message); }
function tooLarge(message: string): never { throw new TaskStateValidationError("TASK_STATE_TOO_LARGE", message); }
function conflict(message: string): never { throw new TaskStateValidationError("TASK_STATE_CONFLICT", message); }

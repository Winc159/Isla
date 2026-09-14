import type { Message, ToolCall } from "./types.js";
export { evaluateCompletionGate } from "./completion-gate.js";
export type { CompletionGateInput, CompletionGateResult, CompletionRejectionReason } from "./completion-gate.js";

/** The only control results produced by a v0.2.7.4 model step. */
export type StepResult =
  | { readonly kind: "capability_calls"; readonly calls: readonly ToolCall[] }
  | { readonly kind: "yield"; readonly text: string };

export type DecisionKind = "answer" | "clarify" | "execute";

export interface ConfirmedConstraint {
  readonly text: string;
  readonly sourceMessageIndex: number;
}

export interface TaskBrief {
  readonly goal: string;
  readonly confirmedConstraints: readonly ConfirmedConstraint[];
  readonly openQuestions: readonly string[];
  readonly assumptions: readonly string[];
  /** Runtime-owned progress marker; absent in pre-v0.2.7.3 sessions. */
  readonly clarificationTurns?: number;
}

export interface EvidenceRequirement {
  readonly external: "none" | "preferred" | "required";
  readonly topics: readonly string[];
}

export type TurnDecision =
  | { readonly kind: "answer"; readonly text: string; readonly task: TaskBrief }
  | { readonly kind: "clarify"; readonly questions: readonly string[]; readonly task: TaskBrief }
  | { readonly kind: "execute"; readonly objective: string; readonly task: TaskBrief; readonly evidenceRequirement: EvidenceRequirement };

const MAX_QUESTIONS = 4;
const MAX_ITEMS = 32;
const MAX_ITEM_CHARS = 1000;

export function parseTurnDecision(text: string, messages: readonly Message[]): TurnDecision {
  let value: unknown;
  try { value = JSON.parse(text.trim()); } catch {
    const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
    const candidate = fenced ?? text.trim().slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    if (!candidate || !candidate.includes("{")) throw new Error("模型决策不是有效 JSON");
    try { value = JSON.parse(candidate); } catch { throw new Error("模型决策不是有效 JSON"); }
  }
  if (!isRecord(value) || Array.isArray(value)) throw new Error("模型决策必须是 JSON 对象");
  const kind = value.kind;
  if (kind !== "answer" && kind !== "clarify" && kind !== "execute") throw new Error("模型决策 kind 无效");
  const task = parseTaskBrief(value.task, messages);
  if (kind === "answer") {
    assertString(value.text, "answer.text");
    return { kind, text: value.text, task };
  }
  if (kind === "clarify") {
    const questions = parseStringArray(value.questions, "questions", MAX_QUESTIONS);
    if (!questions.length) throw new Error("clarify.questions 不能为空");
    return { kind, questions, task };
  }
  assertString(value.objective, "execute.objective");
  return { kind, objective: value.objective, task, evidenceRequirement: parseEvidenceRequirement(value.evidenceRequirement) };
}

function parseEvidenceRequirement(value: unknown): EvidenceRequirement {
  if (value === undefined) return { external: "none", topics: [] };
  if (!isRecord(value) || (value.external !== "none" && value.external !== "preferred" && value.external !== "required")) throw new Error("evidenceRequirement.external 无效");
  return { external: value.external, topics: parseStringArray(value.topics, "evidenceRequirement.topics", 8) };
}

function parseTaskBrief(value: unknown, messages: readonly Message[]): TaskBrief {
  if (!isRecord(value)) throw new Error("task 必须是对象");
  assertString(value.goal, "task.goal");
  const confirmedValue = Array.isArray(value.confirmedConstraints) ? value.confirmedConstraints : undefined;
  if (!confirmedValue || confirmedValue.length > MAX_ITEMS) throw new Error("task.confirmedConstraints 无效");
  const confirmedConstraints = confirmedValue.map((item, index) => {
    if (!isRecord(item)) throw new Error(`confirmedConstraints[${index}] 无效`);
    assertString(item.text, `confirmedConstraints[${index}].text`);
    if (!Number.isInteger(item.sourceMessageIndex) || item.sourceMessageIndex < 0 || item.sourceMessageIndex >= messages.length || messages[item.sourceMessageIndex]?.role !== "user")
      throw new Error(`confirmedConstraints[${index}].sourceMessageIndex 无效`);
    return { text: item.text, sourceMessageIndex: item.sourceMessageIndex };
  });
  return {
    goal: value.goal,
    confirmedConstraints,
    openQuestions: parseStringArray(value.openQuestions, "task.openQuestions", MAX_ITEMS),
    assumptions: parseStringArray(value.assumptions, "task.assumptions", MAX_ITEMS),
    ...(value.clarificationTurns === undefined ? {} : { clarificationTurns: parseNonNegativeInteger(value.clarificationTurns, "task.clarificationTurns") }),
  };
}

function parseNonNegativeInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`${name} 无效`);
  return value as number;
}

function parseStringArray(value: unknown, name: string, max: number): string[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${name} 无效`);
  return value.map((item, index) => {
    assertString(item, `${name}[${index}]`);
    if (item.length > MAX_ITEM_CHARS) throw new Error(`${name}[${index}] 过长`);
    return item;
  });
}

function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} 必须是非空字符串`);
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

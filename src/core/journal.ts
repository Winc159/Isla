import type { Message, ModelRequest, TokenUsage, ToolDefinition } from "./types.js";
import type { SafeErrorRecord } from "./errors.js";

export type TurnStatus = "running" | "completed" | "failed" | "blocked" | "needs_user" | "interrupted" | "cancelled";
export type ModelAttemptStatus = "running" | "succeeded" | "failed" | "interrupted" | "aborted";

export interface ModelRequestSnapshot {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly messages: readonly Message[];
  readonly tools?: readonly ToolDefinition[];
  readonly toolChoice?: ModelRequest["toolChoice"];
  readonly retrievedSourceIds: readonly string[];
  readonly requestHash: string;
}

export interface ModelAttemptRecord {
  attempt: number;
  step: number;
  startedAt: string;
  endedAt?: string;
  status: ModelAttemptStatus;
  request: ModelRequestSnapshot;
  usage?: TokenUsage;
  error?: SafeErrorRecord;
}

export type TurnActionRecord =
  | { readonly type: "tool"; readonly step: number; readonly callId: string; readonly tool: string; readonly ok: boolean; readonly code?: string }
  | { readonly type: "approval"; readonly step: number; readonly callId: string; readonly tool: string; readonly decision: "approved" | "rejected" }
  | { readonly type: "checkpoint"; readonly throughMessageIndex: number }
  | { readonly type: "memory_retrieval"; readonly sourceIds: readonly string[] }
  | { readonly type: "project_retrieval"; readonly sourceIds: readonly string[]; readonly truncated: boolean }
  | { readonly type: "phase"; readonly phase: "understand" | "clarify" | "execute_tools" | "synthesize" }
  | { readonly type: "decision"; readonly kind: "answer" | "clarify" | "execute"; readonly repairAttempted: boolean };

export interface TurnRecord {
  readonly id: string;
  readonly sequence: number;
  readonly startedAt: string;
  endedAt?: string;
  status: TurnStatus;
  readonly userMessageIndex: number;
  assistantMessageIndex?: number;
  readonly attempts: readonly ModelAttemptRecord[];
  readonly actions: readonly TurnActionRecord[];
  error?: SafeErrorRecord;
}

export interface SessionJournal {
  readonly version: 1;
  readonly turns: readonly TurnRecord[];
}

export function validateSessionJournal(journal: SessionJournal, messages: readonly Message[]): void {
  if (journal.version !== 1) throw new Error("Unsupported Session Journal version");
  let previousSequence = 0;
  let previousTurn: TurnRecord | undefined;
  for (const turn of journal.turns) {
    if (!turn.id || !Number.isInteger(turn.sequence) || turn.sequence <= previousSequence) throw new Error("Session Journal turn sequence is invalid");
    if (!Number.isInteger(turn.userMessageIndex) || messages[turn.userMessageIndex]?.role !== "user") throw new Error("Turn userMessageIndex does not reference a user message");
    if (turn.status === "completed" || turn.status === "needs_user" || turn.status === "blocked") {
      if (turn.assistantMessageIndex === undefined || messages[turn.assistantMessageIndex]?.role !== "assistant" || !messages[turn.assistantMessageIndex]?.content.trim()) throw new Error("Completed Turn must reference a non-empty assistant message");
      if (!turn.endedAt) throw new Error("Terminal Turn must have endedAt");
    }
    if (!(["completed", "needs_user", "blocked"] as const).includes(turn.status as "completed" | "needs_user" | "blocked") && turn.assistantMessageIndex !== undefined) throw new Error("Non-completed Turn cannot reference an assistant message");
    if (turn.status !== "running" && !turn.endedAt) throw new Error("Terminal Turn must have endedAt");
    if (turn.status === "cancelled" && turn.error?.code !== "TURN_CANCELLED") throw new Error("Cancelled Turn must have TURN_CANCELLED error");
    if (previousTurn?.status === "running") throw new Error("Only the latest Turn may be running");
    previousSequence = turn.sequence;
    previousTurn = turn;
  }
}

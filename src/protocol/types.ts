import type { ToolExecutionErrorCode } from "../tools/types.js";
import type { UserQuestion, UserQuestionAnswer } from "../user-questions/types.js";
import type { TaskStateV1, TaskStatus } from "../core/task-state.js";
import type { VerificationStatus } from "../core/verification.js";
import type { SessionSearchHit } from "../session-query.js";

export interface ProtocolTaskSummary {
  readonly status: TaskStatus;
  readonly goal: string;
  readonly completedSteps: number;
  readonly totalSteps: number;
  readonly blockerCount: number;
}

export type ProtocolRequest =
  | { readonly type: "prompt"; readonly id: string; readonly text: string }
  | { readonly type: "approval_response"; readonly id: string; readonly approvalId: string; readonly approved: boolean; readonly remember?: boolean }
  | { readonly type: "question_response"; readonly id: string; readonly questionId: string; readonly answers: readonly UserQuestionAnswer[] }
  | { readonly type: "cancel"; readonly id: string; readonly targetId: string }
  | { readonly type: "new_session"; readonly id: string }
  | { readonly type: "exit"; readonly id: string }
  | { readonly type: "models_list"; readonly id: string; readonly query?: string }
  | { readonly type: "models_use"; readonly id: string; readonly model: string }
  | { readonly type: "task_get"; readonly id: string }
  | { readonly type: "sessions_list"; readonly id: string }
  | { readonly type: "skills_list"; readonly id: string }
  | { readonly type: "skill_invoke"; readonly id: string; readonly name: string; readonly text?: string }
  | { readonly type: "sessions_search"; readonly id: string; readonly query?: string; readonly status?: TaskStatus }
  | { readonly type: "session_select"; readonly id: string; readonly sessionId: string };

export type ProtocolToolErrorCode = ToolExecutionErrorCode;

export type ProtocolEvent =
  | { readonly type: "ready"; readonly provider: string; readonly model: string; readonly workspace?: string; readonly capabilities?: ProtocolCapabilities; readonly task?: ProtocolTaskSummary; readonly verificationStatus?: VerificationStatus }
  | { readonly type: "response_start"; readonly id: string }
  | { readonly type: "model_step_start"; readonly id: string; readonly step: number; readonly attempt: number }
  | { readonly type: "model_delta"; readonly id: string; readonly step: number; readonly attempt: number; readonly text: string; readonly provisional: true }
  | { readonly type: "model_step_end"; readonly id: string; readonly step: number; readonly attempt: number; readonly result: "capability_calls" | "candidate_yield" | "failed" | "cancelled" | "retry" }
  | { readonly type: "response_end"; readonly id: string; readonly text: string; readonly elapsedMs: number; readonly projectSources?: readonly { readonly path: string; readonly startLine: number }[]; readonly verificationStatus?: "not_applicable" | "not_run" | "passed_after_last_change" | "failed_after_last_change" }
  | { readonly type: "response_cancelled"; readonly id: string; readonly elapsedMs: number }
  | { readonly type: "cancel_ack"; readonly id: string; readonly targetId: string; readonly accepted: boolean }
  | { readonly type: "tool_start"; readonly id: string; readonly tool: string; readonly callId?: string; readonly query?: string; readonly url?: string }
  | { readonly type: "tool_end"; readonly id: string; readonly tool: string; readonly ok: boolean; readonly code?: ProtocolToolErrorCode }
  | { readonly type: "approval_request"; readonly id: string; readonly approvalId: string; readonly tool: string; readonly permission: string; readonly summary: string }
  | { readonly type: "question_request"; readonly id: string; readonly questionId: string; readonly questions: readonly UserQuestion[] }
  | { readonly type: "session_changed"; readonly id: string; readonly sessionId: string }
  | { readonly type: "error"; readonly id?: string; readonly code: string; readonly message: string; readonly recoverable: boolean }
  | { readonly type: "bye"; readonly id: string }
  | { readonly type: "models_list"; readonly id: string; readonly models: readonly unknown[] }
  | { readonly type: "model_changed"; readonly id: string; readonly model: string; readonly effective: "next_start" }
  | ProtocolTaskStateEvent
  | { readonly type: "sessions_result"; readonly id: string; readonly sessions: readonly SessionSearchHit[]; readonly truncated: boolean }
  | { readonly type: "skills_result"; readonly id: string; readonly skills: readonly { readonly name: string; readonly description: string; readonly modelInvocable: boolean; readonly userInvocable: boolean }[] };

export interface ProtocolTaskStateEvent {
  readonly type: "task_state";
  readonly id: string;
  readonly sessionId: string;
  readonly task?: TaskStateV1;
  readonly verificationStatus: VerificationStatus;
}

export interface ProtocolCapabilities {
  readonly toolCalling: boolean;
  readonly cancellation: boolean;
  readonly streaming: boolean;
  readonly streamingToolCalls?: boolean;
  readonly webFetch?: boolean;
  readonly webSearch?: boolean;
  readonly userQuestions?: boolean;
}

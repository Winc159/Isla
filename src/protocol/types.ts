import type { ToolExecutionErrorCode } from "../tools/types.js";
import type { UserQuestion, UserQuestionAnswer } from "../user-questions/types.js";

export type ProtocolRequest =
  | { readonly type: "prompt"; readonly id: string; readonly text: string }
  | { readonly type: "approval_response"; readonly id: string; readonly approvalId: string; readonly approved: boolean; readonly remember?: boolean }
  | { readonly type: "question_response"; readonly id: string; readonly questionId: string; readonly answers: readonly UserQuestionAnswer[] }
  | { readonly type: "cancel"; readonly id: string; readonly targetId: string }
  | { readonly type: "new_session"; readonly id: string }
  | { readonly type: "exit"; readonly id: string }
  | { readonly type: "models_list"; readonly id: string; readonly query?: string }
  | { readonly type: "models_use"; readonly id: string; readonly model: string };

export type ProtocolToolErrorCode = ToolExecutionErrorCode;

export type ProtocolEvent =
  | { readonly type: "ready"; readonly provider: string; readonly model: string; readonly workspace?: string; readonly capabilities?: ProtocolCapabilities }
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
  | { readonly type: "model_changed"; readonly id: string; readonly model: string; readonly effective: "next_start" };

export interface ProtocolCapabilities {
  readonly toolCalling: boolean;
  readonly cancellation: boolean;
  readonly streaming: boolean;
  readonly streamingToolCalls?: boolean;
  readonly webFetch?: boolean;
  readonly webSearch?: boolean;
  readonly userQuestions?: boolean;
}

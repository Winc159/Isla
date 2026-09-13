export type ProtocolRequest =
  | { readonly type: "prompt"; readonly id: string; readonly text: string }
  | { readonly type: "approval_response"; readonly id: string; readonly approvalId: string; readonly approved: boolean; readonly remember?: boolean }
  | { readonly type: "cancel"; readonly id: string; readonly targetId: string }
  | { readonly type: "new_session"; readonly id: string }
  | { readonly type: "exit"; readonly id: string };

export type ProtocolToolErrorCode = "UNKNOWN_TOOL" | "INVALID_ARGUMENTS" | "PERMISSION_DENIED" | "USER_REJECTED" | "EXECUTION_FAILED" | "SANDBOX_DENIED" | "TURN_CANCELLED" | "WEB_INVALID_URL" | "WEB_HOST_NOT_ALLOWED" | "WEB_BLOCKED_URL" | "WEB_REDIRECT_BLOCKED" | "WEB_FETCH_TOO_LARGE" | "WEB_UNSUPPORTED_CONTENT_TYPE" | "WEB_FETCH_TIMEOUT" | "WEB_NETWORK_ERROR";

export type ProtocolEvent =
  | { readonly type: "ready"; readonly provider: string; readonly model: string; readonly workspace?: string; readonly capabilities?: ProtocolCapabilities }
  | { readonly type: "response_start"; readonly id: string }
  | { readonly type: "response_end"; readonly id: string; readonly text: string; readonly elapsedMs: number; readonly projectSources?: readonly { readonly path: string; readonly startLine: number }[] }
  | { readonly type: "response_cancelled"; readonly id: string; readonly elapsedMs: number }
  | { readonly type: "cancel_ack"; readonly id: string; readonly targetId: string; readonly accepted: boolean }
  | { readonly type: "tool_start"; readonly id: string; readonly tool: string }
  | { readonly type: "tool_end"; readonly id: string; readonly tool: string; readonly ok: boolean; readonly code?: ProtocolToolErrorCode }
  | { readonly type: "approval_request"; readonly id: string; readonly approvalId: string; readonly tool: string; readonly permission: string; readonly summary: string }
  | { readonly type: "session_changed"; readonly id: string; readonly sessionId: string }
  | { readonly type: "error"; readonly id?: string; readonly code: string; readonly message: string; readonly recoverable: boolean }
  | { readonly type: "bye"; readonly id: string };

export interface ProtocolCapabilities {
  readonly toolCalling: boolean;
  readonly cancellation: boolean;
  readonly streaming: boolean;
  readonly webFetch?: boolean;
}

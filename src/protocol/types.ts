export type ProtocolRequest =
  | { readonly type: "prompt"; readonly id: string; readonly text: string }
  | { readonly type: "approval_response"; readonly id: string; readonly approvalId: string; readonly approved: boolean; readonly remember?: boolean }
  | { readonly type: "new_session"; readonly id: string }
  | { readonly type: "exit"; readonly id: string };

export type ProtocolToolErrorCode = "UNKNOWN_TOOL" | "INVALID_ARGUMENTS" | "PERMISSION_DENIED" | "USER_REJECTED" | "EXECUTION_FAILED" | "SANDBOX_DENIED";

export type ProtocolEvent =
  | { readonly type: "ready"; readonly provider: string; readonly model: string }
  | { readonly type: "response_start"; readonly id: string }
  | { readonly type: "response_end"; readonly id: string; readonly text: string; readonly elapsedMs: number; readonly projectSources?: readonly { readonly path: string; readonly startLine: number }[] }
  | { readonly type: "tool_start"; readonly id: string; readonly tool: string }
  | { readonly type: "tool_end"; readonly id: string; readonly tool: string; readonly ok: boolean; readonly code?: ProtocolToolErrorCode }
  | { readonly type: "approval_request"; readonly id: string; readonly approvalId: string; readonly tool: string; readonly permission: string; readonly summary: string }
  | { readonly type: "session_changed"; readonly id: string; readonly sessionId: string }
  | { readonly type: "error"; readonly id?: string; readonly code: string; readonly message: string; readonly recoverable: boolean }
  | { readonly type: "bye"; readonly id: string };

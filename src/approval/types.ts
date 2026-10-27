export type ToolPermission =
  | { readonly kind: "none" }
  | { readonly kind: "filesystem-read" }
  | { readonly kind: "filesystem-write" }
  | { readonly kind: "command-execute" }
  | { readonly kind: "process-interact" }
  | { readonly kind: "network" }
  | { readonly kind: "network-download" }
  | { readonly kind: "dependency-install" }
  | { readonly kind: "mcp-invoke" }
  | { readonly kind: "credential-use" }
  | { readonly kind: "sandbox-elevate" };

export type ApprovalPolicy = "never" | "ask" | "always";
export interface ApprovalRequest { readonly toolName: string; readonly permission: ToolPermission; readonly summary: string; readonly details?: string; }
export type ApprovalDecision = { readonly approved: true } | { readonly approved: false; readonly reason?: string };
export interface ApprovalRequestOptions { readonly signal?: AbortSignal; }
export interface ApprovalService { request(request: ApprovalRequest, options?: ApprovalRequestOptions): Promise<ApprovalDecision>; }

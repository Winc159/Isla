export type ToolPermission =
  | { readonly kind: "none" }
  | { readonly kind: "filesystem-read" }
  | { readonly kind: "filesystem-write" }
  | { readonly kind: "command-execute" }
  | { readonly kind: "network" };

export type ApprovalPolicy = "never" | "ask" | "always";
export interface ApprovalRequest { readonly toolName: string; readonly permission: ToolPermission; readonly summary: string; readonly details?: string; }
export type ApprovalDecision = { readonly approved: true } | { readonly approved: false; readonly reason?: string };
export interface ApprovalService { request(request: ApprovalRequest): Promise<ApprovalDecision>; }

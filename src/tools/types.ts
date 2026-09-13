import type { ToolDefinition } from "../core/types.js";
import type { ToolPermission } from "../approval/types.js";

export interface Tool {
  readonly definition: ToolDefinition;
  readonly permission?: ToolPermission;
  describe?(argumentsJson: string): string | Promise<string>;
  execute(argumentsJson: string, options?: { readonly signal?: AbortSignal }): Promise<string | ToolOutput>;
}

export interface ProjectSearchToolSource { readonly id: string; readonly path: string; readonly startLine: number; readonly endLine: number; }
export interface ProjectSearchToolDetails { readonly type: "project_search"; readonly sources: readonly ProjectSearchToolSource[]; readonly filesScanned: number; readonly truncated: boolean; }
export type ToolSuccessDetails = ProjectSearchToolDetails;
export interface ToolOutput { readonly content: string; readonly details?: ToolSuccessDetails; }

export type ToolExecutionResult =
  | { readonly ok: true; readonly content: string; readonly details?: ToolSuccessDetails }
  | { readonly ok: false; readonly code: "UNKNOWN_TOOL" | "INVALID_ARGUMENTS" | "PERMISSION_DENIED" | "USER_REJECTED" | "EXECUTION_FAILED" | "SANDBOX_DENIED" | "TURN_CANCELLED"; readonly message: string };

export interface ToolCapability {
  readonly id: string;
  readonly instructions: string;
  readonly tools: readonly Tool[];
}

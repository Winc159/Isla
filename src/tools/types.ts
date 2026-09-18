import type { ToolDefinition } from "../core/types.js";
import type { ToolPermission } from "../approval/types.js";
import type { ToolFailureCode } from "./errors.js";

export interface Tool {
  readonly definition: ToolDefinition;
  readonly permission?: ToolPermission;
  describe?(argumentsJson: string, options?: { readonly signal?: AbortSignal; readonly webFetchAllowedUrls?: readonly string[] }): string | Promise<string>;
  execute(argumentsJson: string, options?: { readonly signal?: AbortSignal; readonly webFetchAllowedUrls?: readonly string[] }): Promise<string | ToolOutput>;
}

export interface ProjectSearchToolSource { readonly id: string; readonly path: string; readonly startLine: number; readonly endLine: number; }
export interface ProjectSearchToolDetails { readonly type: "project_search"; readonly sources: readonly ProjectSearchToolSource[]; readonly filesScanned: number; readonly truncated: boolean; }
export interface WebFetchToolDetails { readonly type: "web_fetch"; readonly requestedUrl: string; readonly finalUrl: string; readonly statusCode: number; readonly contentType: string; readonly bodyKind: "html" | "text"; readonly bytesRead: number; readonly truncated: boolean; }
export interface WebSearchToolDetails { readonly type: "web_search"; readonly provider: string; readonly query: string; readonly sources: readonly import("../web/types.js").WebSearchSource[]; readonly truncated: boolean; readonly hasProviderContent: boolean; }
export interface CommandExecutionToolDetails { readonly type: "command_execution"; readonly shell: "powershell" | "bash"; readonly workdir: string; readonly exitCode: number | null; readonly signal: NodeJS.Signals | null; readonly timedOut: boolean; readonly aborted: boolean; readonly purpose: "verification" | "other"; readonly stdoutTruncated: boolean; readonly stderrTruncated: boolean; }
export interface TaskStateUpdateToolDetails { readonly type: "task_state_update"; readonly state: { readonly goal: string; readonly status: "active" | "blocked" | "completed"; readonly constraints: readonly { readonly text: string; readonly sourceMessageIndex?: number }[]; readonly assumptions: readonly string[]; readonly openQuestions: readonly string[]; readonly steps: readonly { readonly id?: string; readonly title: string; readonly status: "pending" | "in_progress" | "completed" | "blocked" }[]; readonly blockers: readonly string[] } }
export type ToolSuccessDetails = ProjectSearchToolDetails | WebFetchToolDetails | WebSearchToolDetails | CommandExecutionToolDetails | TaskStateUpdateToolDetails;
export interface ToolOutput { readonly content: string; readonly details?: ToolSuccessDetails; }

export type ToolExecutionErrorCode = ToolFailureCode | "UNKNOWN_TOOL" | "PERMISSION_DENIED" | "USER_REJECTED";

export type ToolExecutionResult =
  | { readonly ok: true; readonly content: string; readonly details?: ToolSuccessDetails }
  | { readonly ok: false; readonly code: ToolExecutionErrorCode; readonly message: string };

export interface ToolCapability {
  readonly id: string;
  readonly instructions: string;
  readonly tools: readonly Tool[];
}

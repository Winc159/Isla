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
export interface WebFetchToolDetails { readonly type: "web_fetch"; readonly requestedUrl: string; readonly finalUrl: string; readonly statusCode: number; readonly contentType: string; readonly bodyKind: "html" | "text"; readonly bytesRead: number; readonly truncated: boolean; }
export interface WebSearchToolDetails { readonly type: "web_search"; readonly provider: string; readonly query: string; readonly sources: readonly import("../web/types.js").WebSearchSource[]; readonly truncated: boolean; readonly hasProviderContent: boolean; }
export type ToolSuccessDetails = ProjectSearchToolDetails | WebFetchToolDetails | WebSearchToolDetails;
export interface ToolOutput { readonly content: string; readonly details?: ToolSuccessDetails; }

export type ToolExecutionResult =
  | { readonly ok: true; readonly content: string; readonly details?: ToolSuccessDetails }
  | { readonly ok: false; readonly code: "UNKNOWN_TOOL" | "INVALID_ARGUMENTS" | "PERMISSION_DENIED" | "USER_REJECTED" | "EXECUTION_FAILED" | "SANDBOX_DENIED" | "TURN_CANCELLED" | "WEB_INVALID_URL" | "WEB_HOST_NOT_ALLOWED" | "WEB_BLOCKED_URL" | "WEB_REDIRECT_BLOCKED" | "WEB_FETCH_TOO_LARGE" | "WEB_UNSUPPORTED_CONTENT_TYPE" | "WEB_FETCH_TIMEOUT" | "WEB_NETWORK_ERROR" | "WEB_SEARCH_INVALID_QUERY" | "WEB_SEARCH_UNAVAILABLE" | "WEB_SEARCH_TIMEOUT" | "WEB_SEARCH_RATE_LIMITED" | "WEB_SEARCH_RESPONSE_INVALID" | "WEB_SEARCH_NETWORK_ERROR"; readonly message: string };

export interface ToolCapability {
  readonly id: string;
  readonly instructions: string;
  readonly tools: readonly Tool[];
}

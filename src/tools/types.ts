import type { ToolDefinition } from "../core/types.js";
import type { ToolPermission } from "../approval/types.js";

export interface Tool {
  readonly definition: ToolDefinition;
  readonly permission?: ToolPermission;
  describe?(argumentsJson: string): string | Promise<string>;
  execute(argumentsJson: string): Promise<string>;
}

export type ToolExecutionResult =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly code: "UNKNOWN_TOOL" | "INVALID_ARGUMENTS" | "PERMISSION_DENIED" | "USER_REJECTED" | "EXECUTION_FAILED" | "SANDBOX_DENIED"; readonly message: string };

export interface ToolCapability {
  readonly id: string;
  readonly instructions: string;
  readonly tools: readonly Tool[];
}

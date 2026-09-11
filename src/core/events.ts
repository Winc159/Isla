import type { ToolExecutionResult } from "../tools/types.js";

export type SessionEvent =
  | { readonly type: "user"; readonly input: string }
  | { readonly type: "tool_call"; readonly callId: string; readonly tool: string; readonly arguments: string }
  | { readonly type: "tool_result"; readonly callId: string; readonly tool: string; readonly result: ToolExecutionResult }
  | { readonly type: "assistant"; readonly text: string };

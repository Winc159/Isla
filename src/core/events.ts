import type { ToolExecutionResult } from "../tools/types.js";

export type SessionEvent =
  | { readonly type: "user"; readonly input: string }
  | { readonly type: "tool_call"; readonly callId: string; readonly tool: string; readonly arguments: string }
  | { readonly type: "tool_result"; readonly callId: string; readonly tool: string; readonly result: ToolExecutionResult }
  | { readonly type: "assistant"; readonly text: string };

export type ModelStepEvent =
  | { readonly type: "model_step_start"; readonly step: number; readonly attempt: number }
  | { readonly type: "model_delta"; readonly step: number; readonly attempt: number; readonly text: string; readonly provisional: true }
  | {
      readonly type: "model_step_end";
      readonly step: number;
      readonly attempt: number;
      readonly result: "capability_calls" | "candidate_yield" | "failed" | "cancelled" | "retry";
    };

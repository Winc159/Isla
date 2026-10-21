import type { ToolExecutionResult } from "../tools/types.js";

/** Observable phases of one Agent turn. This is deliberately a small public state machine. */
export type TurnPhase =
  | "idle"
  | "preflight"
  | "model"
  | "awaiting_tool_approval"
  | "executing_tools"
  | "observing"
  | "compacting"
  | "settling"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled";

export interface TurnPhaseEvent {
  readonly phase: TurnPhase;
  readonly round?: number;
  readonly tool?: string;
  readonly detail?: string;
}

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

import type { IntentResult } from "./intent.js";
import type { TurnOutcome } from "./types.js";
import type { ToolExecutionResult } from "../tools/types.js";
import type { Message } from "./types.js";

export type SessionEvent =
  | { readonly type: "user"; readonly input: string }
  | { readonly type: "intent"; readonly intent: IntentResult }
  | { readonly type: "tool_call"; readonly callId: string; readonly tool: string; readonly arguments: string }
  | { readonly type: "tool_result"; readonly callId: string; readonly tool: string; readonly result: ToolExecutionResult }
  | { readonly type: "assistant"; readonly text: string; readonly outcome?: TurnOutcome }
  | { readonly type: "turn_summary"; readonly turn: number; readonly category: string; readonly evidence: readonly string[]; readonly outcome: TurnOutcome };

export function projectModelMessages(events: readonly SessionEvent[]): Message[] {
  const messages: Message[] = [];
  for (const event of events) {
    if (event.type === "user") messages.push({ role: "user", content: event.input });
    else if (event.type === "assistant") messages.push({ role: "assistant", content: event.text });
    else if (event.type === "tool_call") messages.push({ role: "assistant", content: "", toolCalls: [{ id: event.callId, name: event.tool, arguments: event.arguments }] });
    else if (event.type === "tool_result") messages.push({ role: "tool", toolCallId: event.callId, content: event.result.ok ? event.result.content : `[${event.result.code}] ${event.result.message}` });
  }
  return messages;
}

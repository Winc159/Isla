import type { ToolExecutionResult } from "../tools/types.js";
import { pruneToolResult, type PrunedToolResult } from "./tool-result-pruner.js";
import type { Message } from "./types.js";

export interface PreparedToolResultMessage {
  readonly message: Message;
  readonly pruning: PrunedToolResult;
}

export function prepareToolResultMessage(toolCallId: string, result: ToolExecutionResult, includeEvidenceCallId = false): PreparedToolResultMessage {
  const content = result.ok ? `${result.content}${includeEvidenceCallId ? `\nEvidence Tool Call ID: ${toolCallId}` : ''}` : `[${result.code}] ${result.message}`;
  const pruning = pruneToolResult(content);
  return {
    message: { role: "tool", toolCallId, content: pruning.content },
    pruning,
  };
}

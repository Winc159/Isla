import type { ModelResponse, ToolCall } from './types.js';
import type { ToolExecutionResult } from '../tools/types.js';

export interface ToolBatchExecutionInput {
  readonly calls: readonly ToolCall[];
  readonly model?: string;
  readonly round: number;
}

export interface ToolBatchExecutionResult {
  readonly nextMessages: readonly import('./types.js').Message[];
  readonly executions: readonly ToolExecutionResult[];
  readonly terminal?: Pick<ModelResponse, 'text' | 'outcome' | 'model'>;
}

/** Stable boundary for the next extraction of Session's tool batch executor. */
export function createToolBatchExecutionInput(response: { readonly toolCalls?: readonly ToolCall[]; readonly model?: string }, round: number): ToolBatchExecutionInput {
  return { calls: response.toolCalls ?? [], ...(response.model ? { model: response.model } : {}), round };
}

import type { ModelResponse } from './types.js';

export interface ToolBatchState {
  readonly model?: string;
  readonly round: number;
  readonly callCount: number;
  readonly completedCount: number;
  readonly stopped: boolean;
  readonly stopReason?: string;
}

export function createToolBatchState(response: Pick<ModelResponse, 'model'>, round: number, callCount: number): ToolBatchState {
  return { ...(response.model ? { model: response.model } : {}), round, callCount, completedCount: 0, stopped: false };
}

export function stopToolBatch(state: ToolBatchState, reason: string, completedCount = state.completedCount): ToolBatchState {
  return { ...state, completedCount, stopped: true, stopReason: reason };
}

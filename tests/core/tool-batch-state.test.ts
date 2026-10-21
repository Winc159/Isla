import { describe, expect, it } from 'vitest';
import { createToolBatchState, stopToolBatch } from '../../src/core/tool-batch-state.js';

describe('tool batch state', () => {
  it('tracks a batch independently from the model response', () => {
    const state = createToolBatchState({ model: 'fake' }, 2, 3);
    expect(state).toMatchObject({ model: 'fake', round: 2, callCount: 3, completedCount: 0, stopped: false });
    expect(stopToolBatch(state, 'user_rejected', 1)).toMatchObject({ stopped: true, stopReason: 'user_rejected', completedCount: 1 });
  });
});

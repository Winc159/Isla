import { describe, expect, it } from 'vitest';
import { createToolBatchExecutionInput } from '../../src/core/tool-batch-contract.js';

describe('tool batch contract', () => {
  it('normalizes a model tool response into an execution input', () => {
    const input = createToolBatchExecutionInput({ model: 'fake', toolCalls: [{ id: 'c1', name: 'read_text_file', arguments: '{}' }] }, 3);
    expect(input).toEqual({ model: 'fake', round: 3, calls: [{ id: 'c1', name: 'read_text_file', arguments: '{}' }] });
  });
  it('does not invent calls when the model omitted them', () => {
    expect(createToolBatchExecutionInput({ model: 'fake' }, 0).calls).toEqual([]);
  });
});

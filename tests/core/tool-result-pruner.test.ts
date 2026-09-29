import { describe, expect, it } from 'vitest';
import { pruneToolResult } from '../../src/core/tool-result-pruner.js';

describe('tool result pruner', () => {
  it('keeps short results unchanged', () => expect(pruneToolResult('abc', 10)).toMatchObject({ content: 'abc', pruned: false }));
  it('keeps head and tail with a recoverable marker', () => {
    const result = pruneToolResult('START-' + 'x'.repeat(100) + '-END', 40);
    expect(result.pruned).toBe(true);
    expect(result.content.startsWith('START-')).toBe(true);
    expect(result.content.endsWith('-END')).toBe(true);
    expect(result.content).toContain('TOOL_RESULT_PRUNED');
  });
});

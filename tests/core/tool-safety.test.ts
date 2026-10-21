import { describe, expect, it } from 'vitest';
import { isParallelSafeTool } from '../../src/core/tool-scheduler.js';

describe('tool safety classifier', () => {
  it('fails closed for mutation, command, browser and unknown tools', () => {
    expect(isParallelSafeTool('write_text_file')).toBe(false);
    expect(isParallelSafeTool('command_execution')).toBe(false);
    expect(isParallelSafeTool('browser_open')).toBe(false);
    expect(isParallelSafeTool('future_tool')).toBe(false);
  });
  it('only allows explicitly reviewed read tools', () => {
    expect(isParallelSafeTool('read_text_file')).toBe(true);
    expect(isParallelSafeTool('project_search')).toBe(true);
  });
});

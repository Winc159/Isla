import { describe, expect, it } from 'vitest';
import { classifyTool } from '../src/tools/catalog.js';

describe('tool catalog classifications', () => {
  it('keeps read, write, search and execution boundaries distinct', () => {
    expect(classifyTool('read_text_file')).toMatchObject({ category: 'file', boundary: 'read' });
    expect(classifyTool('edit_text_file')).toMatchObject({ category: 'file', boundary: 'write' });
    expect(classifyTool('grep_project')).toMatchObject({ category: 'search', boundary: 'read' });
    expect(classifyTool('run_command')).toMatchObject({ category: 'command', boundary: 'execute' });
  });

  it('does not silently treat unknown tools as safe reads', () => {
    expect(classifyTool('third_party_unknown')).toMatchObject({ category: 'other', boundary: 'control' });
  });
});

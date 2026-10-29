import { describe, expect, it } from 'vitest';
import { evaluateToolProgress } from '../../src/core/progress-evaluator.js';

describe('ProgressEvaluator', () => {
  it('does not count a successful empty observation as progress', () => {
    expect(evaluateToolProgress('list_directory', { ok: true, content: '[]' })).toMatchObject({ changed: false, kind: 'observation' });
  });
  it('does not count an identical task-state update as progress', () => {
    expect(evaluateToolProgress('update_task_state', { ok: true, content: 'unchanged', details: { type: 'task_state_update', changed: false, state: { goal: 'task', status: 'active', constraints: [], assumptions: [], openQuestions: [], steps: [], blockers: [] } } })).toMatchObject({ changed: false, kind: 'task_update', reason: 'task_state_unchanged' });
  });
  it('counts evidence, mutation and verification separately', () => {
    expect(evaluateToolProgress('project_search', { ok: true, content: 'found', details: { type: 'project_search', sources: [{ id: 's', path: 'README.md', startLine: 1, endLine: 2 }], filesScanned: 1, truncated: false } })).toMatchObject({ changed: true, kind: 'evidence' });
    expect(evaluateToolProgress('write_text_file', { ok: true, content: 'written' })).toMatchObject({ changed: true, kind: 'mutation' });
  });
  it('does not count failed verification as progress', () => {
    expect(evaluateToolProgress('command_execution', { ok: true, content: 'failed', details: { type: 'command_execution', shell: 'powershell', workdir: '.', exitCode: 1, signal: null, timedOut: false, aborted: false, purpose: 'verification', stdoutTruncated: false, stderrTruncated: false } })).toMatchObject({ changed: false, kind: 'verification' });
  });
});

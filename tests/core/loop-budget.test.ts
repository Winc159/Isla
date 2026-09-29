import { describe, expect, it } from 'vitest';
import { LoopBudgetState } from '../../src/core/loop-budget.js';

describe('LoopBudgetState', () => {
  it('extends in bounded chunks only when recent work is not stuck', () => {
    const state = new LoopBudgetState();
    expect(state.currentBudget).toBe(12);
    state.record({ action: 'a', result: '1', changed: true });
    state.record({ action: 'b', result: '2', changed: true });
    expect(state.tryExtend()).toBe(true);
    expect(state.currentBudget).toBe(20);
    expect(state.tryExtend()).toBe(true);
    expect(state.currentBudget).toBe(28);
    expect(state.tryExtend()).toBe(false);
  });
  it('stops repeated actions and errors', () => {
    const state = new LoopBudgetState();
    for (let index = 0; index < 3; index += 1) state.record({ action: 'same', result: 'same', changed: false, errorCode: 'E' });
    expect(state.isStuck()).toBe(true);
    expect(state.tryExtend()).toBe(false);
  });
  it('allows approved extensions through the hard limit', () => {
    const state = new LoopBudgetState();
    expect(state.tryExtend()).toBe(true);
    expect(state.tryExtend()).toBe(true);
    expect(state.currentBudget).toBe(28);
    expect(state.extendAfterApproval()).toBe(true);
    expect(state.currentBudget).toBe(36);
    expect(state.extendAfterApproval()).toBe(true);
    expect(state.currentBudget).toBe(40);
    expect(state.extendAfterApproval()).toBe(false);
  });
  it('detects a bounded alternating action/result loop', () => {
    const state = new LoopBudgetState();
    for (const item of [['a', '1'], ['b', '2'], ['a', '1'], ['b', '2'], ['a', '1'], ['b', '2']] as const) state.record({ action: item[0], result: item[1], changed: false });
    expect(state.hasAlternatingLoop()).toBe(true);
    expect(state.tryExtend()).toBe(false);
  });
  it('stops repeated failures even when another tool is interleaved', () => {
    const state = new LoopBudgetState();
    state.record({ action: 'browser_open:{}', result: 'EPERM', changed: false, errorCode: 'EXECUTION_FAILED' });
    state.record({ action: 'search_session_history:{}', result: 'ok', changed: true });
    state.record({ action: 'browser_open:{}', result: 'EPERM again', changed: false, errorCode: 'EXECUTION_FAILED' });
    state.record({ action: 'observe:{}', result: 'none', changed: true });
    state.record({ action: 'browser_open:{}', result: 'EPERM third', changed: false, errorCode: 'EXECUTION_FAILED' });
    expect(state.hasRepeatedFailure()).toBe(true);
    expect(state.shouldStop()).toBe(true);
  });
});

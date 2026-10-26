import { describe, expect, it } from 'vitest';
import { createFailureRecord } from '../../src/core/failure-ledger.js';
import { chooseRecovery, recoveryObservation } from '../../src/core/recovery-policy.js';

describe('recovery policy', () => {
  it('classifies failures and changes strategy after repeated identical actions', () => {
    const first = createFailureRecord({ code: 'INVALID_ARGUMENTS', action: 'run_command:{"command":"bad"}', step: 1 });
    const second = createFailureRecord({ code: 'INVALID_ARGUMENTS', action: 'run_command:{"command":"bad"}', step: 2 });
    expect(first.category).toBe('invalid_action');
    expect(chooseRecovery(first, [])).toBe('replan');
    expect(chooseRecovery(second, [first, second])).toBe('replan');
    expect(recoveryObservation('replan', first.category)).toContain('改变工具');
  });

  it('never retries cancellation or permission rejection automatically', () => {
    const cancelled = createFailureRecord({ code: 'TURN_CANCELLED', action: 'write_text_file', step: 1 });
    const denied = createFailureRecord({ code: 'PERMISSION_DENIED', action: 'run_command', step: 1 });
    expect(chooseRecovery(cancelled, [])).toBe('cancel');
    expect(chooseRecovery(denied, [])).toBe('request_user');
  });
});

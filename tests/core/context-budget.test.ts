import { describe, expect, it } from 'vitest';
import { measureContextBudget } from '../../src/core/context.js';

describe('context budget measurement', () => {
  it('reports deterministic character and turn budgets without changing messages', () => {
    const messages = [{ role: 'system' as const, content: 'system' }, { role: 'user' as const, content: 'hello' }];
    expect(measureContextBudget(messages, { maxTurns: 1, maxChars: 100 })).toMatchObject({ turns: 1, maxTurns: 1, maxChars: 100, needsCompaction: false });
    expect(messages).toHaveLength(2);
  });
});

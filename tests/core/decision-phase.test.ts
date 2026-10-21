import { describe, expect, it } from 'vitest';
import { runDecisionPhase } from '../../src/core/decision-phase.js';

describe('decision phase', () => {
  it('parses one structured decision without exposing reasoning', async () => {
    const provider = { id: 'fake', model: 'fake', generate: async () => ({ text: JSON.stringify({ kind: 'answer', text: '可以', task: { goal: '回答问题', confirmedConstraints: [], openQuestions: [], assumptions: [] } }) }) };
    const result = await runDecisionPhase(provider, [{ role: 'user', content: '可以吗？' }]);
    expect(result).toMatchObject({ repaired: false, decision: { kind: 'answer', text: '可以' } });
  });

  it('allows at most one JSON repair', async () => {
    let calls = 0;
    const provider = { id: 'fake', model: 'fake', generate: async () => ({ text: ++calls === 1 ? 'not json' : JSON.stringify({ kind: 'clarify', questions: ['需要哪天？'], task: { goal: '安排', confirmedConstraints: [], openQuestions: ['日期'], assumptions: [] } }) }) };
    const result = await runDecisionPhase(provider, [{ role: 'user', content: '安排一下' }]);
    expect(calls).toBe(2);
    expect(result.repaired).toBe(true);
    expect(result.decision.kind).toBe('clarify');
  });
});

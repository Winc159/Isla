import { describe, expect, it } from 'vitest';
import { validateWorkPlan } from '../../src/core/work-plan.js';

const valid = { version: 1 as const, planId:'p1', revision:1, goal:'Fix module', constraints:[], assumptions:[], steps:[{id:'a',title:'Inspect',status:'pending' as const,dependencies:[]},{id:'b',title:'Fix',status:'pending' as const,dependencies:['a']}], risks:[], verification:['tests'], openQuestions:[], status:'active' as const, updatedAt:new Date(0).toISOString() };
describe('work plan contract', () => {
  it('accepts ordered dependency references', () => expect(validateWorkPlan(valid)).toEqual(valid));
  it('rejects unknown dependencies and stale approvals', () => {
    expect(() => validateWorkPlan({...valid, steps:[{...valid.steps[0]!, dependencies:['missing']}, valid.steps[1]!]})).toThrow('PLAN_DEPENDENCY_INVALID');
    expect(() => validateWorkPlan({...valid, approvedRevision:0})).toThrow('PLAN_APPROVAL_STALE');
  });
});

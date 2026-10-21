import { describe, expect, it } from 'vitest';
import { migrateTaskStateToContract, TaskContractValidationError, validateTaskContract } from '../../src/core/task-contract.js';

const base = { version: 1 as const, revision: 2, goal: '发布版本', deliverables: ['npm 包'], successCriteria: ['测试通过'], constraints: [], assumptions: [], openQuestions: [], steps: [{ id: 's1', title: '验证', status: 'completed' as const, deliverables: ['报告'] }], evidence: [], blockers: [], status: 'active' as const, updatedAt: 'now' };

describe('TaskContractV1', () => {
  it('validates bounded deliverables, criteria, steps and evidence', () => {
    expect(validateTaskContract(base).goal).toBe('发布版本');
    expect(() => validateTaskContract({ ...base, steps: [{ ...base.steps[0], status: 'completed' as const }, { ...base.steps[0] }] })).toThrow(TaskContractValidationError);
  });

  it('rejects completed contracts with pending work', () => {
    expect(() => validateTaskContract({ ...base, status: 'completed', steps: [{ ...base.steps[0], status: 'pending' as const }] })).toThrow('completed contract');
    expect(() => validateTaskContract({ ...base, status: 'blocked' })).toThrow('blocked contract');
  });

  it('migrates existing TaskStateV1 without inventing evidence', () => {
    const contract = migrateTaskStateToContract({ version: 1, revision: 3, goal: '旧任务', status: 'active', constraints: [], assumptions: [], openQuestions: [], steps: [], blockers: [], updatedAt: 'old' });
    expect(contract).toMatchObject({ version: 1, revision: 3, goal: '旧任务', deliverables: [], successCriteria: [], evidence: [], updatedAt: 'old' });
  });
});

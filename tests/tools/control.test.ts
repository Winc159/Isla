import { describe, expect, it } from 'vitest';
import { createControlCapability } from '../../src/tools/control.js';
import { toolAllowedInMode } from '../../src/tools/mode-policy.js';

describe('control capability work-plan contracts', () => {
  const tools = createControlCapability().tools;

  it('separates plan proposals from evidence-backed progress updates', async () => {
    const proposal = tools.find(tool => tool.definition.name === 'propose_work_plan')!;
    expect(proposal.definition.parameters).toMatchObject({ required: ['goal', 'steps', 'verification'], additionalProperties: false });
    expect(proposal.definition.parameters.properties).not.toHaveProperty('planId');
    expect(proposal.definition.parameters.properties).not.toHaveProperty('status');
    const stepSchema = (proposal.definition.parameters.properties?.steps as { items: { properties: Record<string, unknown>; required: string[] } }).items;
    expect(stepSchema.required).toEqual(['id', 'title', 'kind', 'dependencies']);
    expect(stepSchema.properties).not.toHaveProperty('status');

    const result = await proposal.execute(JSON.stringify({
      goal: '修复并验证',
      steps: [
        { id: 'inspect', title: '检查现状', kind: 'inspect', dependencies: [] },
        { id: 'change', title: '修改实现', kind: 'change', dependencies: ['inspect'] },
        { id: 'verify', title: '运行测试', kind: 'verify', dependencies: ['change'] },
      ],
      verification: ['测试通过'],
    }));
    expect(result).toMatchObject({ details: { type: 'work_plan_proposal', plan: { revision: 0, status: 'active', steps: [{ status: 'pending' }, { status: 'pending' }, { status: 'pending' }] } } });
    expect((result as { details: { plan: { planId: string } } }).details.plan.planId).toBeTruthy();
    await expect(proposal.execute(JSON.stringify({ goal: '伪造状态', status: 'completed', steps: [{ id: 'step', title: 'done', kind: 'inspect', dependencies: [], status: 'completed' }], verification: ['tests'] }))).rejects.toThrow('CONTROL_ARGUMENTS_INVALID');
  });

  it('accepts progress only through its dedicated minimal schema', async () => {
    const progress = tools.find(tool => tool.definition.name === 'update_work_plan_progress')!;
    expect(progress.definition.parameters).toMatchObject({ required: ['stepId', 'stepStatus'], additionalProperties: false });
    expect(progress.definition.parameters.properties).not.toHaveProperty('goal');
    await expect(progress.execute(JSON.stringify({ stepId: 'change', stepStatus: 'completed', evidenceCallIds: ['write-call'] })))
      .resolves.toMatchObject({ details: { type: 'work_plan_progress', stepId: 'change', status: 'completed', evidenceCallIds: ['write-call'] } });
  });

  it('keeps proposal and execution tools on opposite sides of the approval boundary', () => {
    expect(toolAllowedInMode('propose_work_plan', 'plan')).toBe(true);
    expect(toolAllowedInMode('propose_work_plan', 'act')).toBe(false);
    expect(toolAllowedInMode('update_work_plan_progress', 'plan')).toBe(false);
    expect(toolAllowedInMode('update_work_plan_progress', 'act')).toBe(true);
  });

});

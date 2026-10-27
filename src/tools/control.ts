import type { ToolCapability } from './types.js';

const MAX_TEXT = 12000;
const MAX_ITEM = 1000;

export function createControlCapability(): ToolCapability {
  return {
    id: 'control',
    instructions: 'Host 控制面：提交最终候选结果或报告当前阻塞。调用只产生提案，最终状态由 Runtime 判定。',
    tools: [
      {
        definition: {
          name: 'update_work_plan',
          description: 'Plan 模式使用 action=revise 提交完整计划；Act 模式使用 action=progress 更新一个步骤的状态。completed/blocked 必须引用已成功/失败的真实 Tool Call ID。结构修改由 Runtime 增加 revision 并撤销批准；进度更新只增加 progressRevision。',
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['action'],
            properties: {
              action: { type: 'string', enum: ['revise','progress'] },
              stepId: { type: 'string' },
              stepStatus: { type: 'string', enum: ['pending','in_progress','completed','blocked'] },
              evidenceCallIds: { type: 'array', items: { type: 'string' }, uniqueItems: true },
              planId: { type: 'string' },
              goal: { type: 'string' },
              constraints: { type: 'array', items: { type: 'string' } },
              assumptions: { type: 'array', items: { type: 'string' } },
              steps: {
                type: 'array',
                items: {
                  type: 'object', additionalProperties: false,
                  required: ['id','title','status','dependencies'],
                  properties: {
                    id: { type: 'string' }, title: { type: 'string' },
                    status: { type: 'string', enum: ['pending','in_progress','completed','blocked'] },
                    dependencies: { type: 'array', items: { type: 'string' } },
                    kind: { type: 'string', enum: ['inspect','change','verify','other'] },
                    evidenceCallIds: { type: 'array', items: { type: 'string' }, uniqueItems: true },
                  },
                },
              },
              risks: { type: 'array', items: { type: 'string' } },
              verification: { type: 'array', items: { type: 'string' } },
              openQuestions: { type: 'array', items: { type: 'string' } },
              status: { type: 'string', enum: ['active','blocked','completed'] },
            },
          },
        },
        async execute(raw) {
          const args = parseObject(raw);
          if (args.action === 'progress') {
            const stepId = requiredString(args.stepId, MAX_ITEM);
            const status = args.stepStatus;
            if (!['pending','in_progress','completed','blocked'].includes(String(status))) throw new Error('WORK_PLAN_PROGRESS_INVALID');
            const evidenceCallIds = optionalStrings(args.evidenceCallIds, MAX_ITEM) ?? [];
            return { content: 'Work Plan progress submitted for Runtime evidence validation.', details: { type: 'work_plan_progress', stepId, status: status as import('../core/work-plan.js').WorkPlanStep['status'], evidenceCallIds } };
          }
          if (args.action !== 'revise') throw new Error('WORK_PLAN_ACTION_INVALID');
          if (args.planId === undefined || args.goal === undefined || args.steps === undefined) throw new Error('WORK_PLAN_REVISION_INVALID');
          if (args.verification === undefined) args.verification = ['Run the relevant automated tests and inspect the resulting diff.'];
          const defaults = { constraints: [], assumptions: [], risks: [], openQuestions: [], status: 'active' };
          for (const [key, value] of Object.entries(defaults)) if (args[key] === undefined) args[key] = value;
          const plan = args as unknown as import('../core/work-plan.js').WorkPlanV1;
          return { content:'Plan update submitted for Runtime validation.', details:{type:'work_plan_update', plan:{...plan,version:1,revision:0,updatedAt:new Date().toISOString()} } };
        },
      },
      {
        definition: {
          name: 'submit_result',
          description: '提交本轮最终回答候选；不要填写状态字段，Runtime 会独立判定是否完成。',
          parameters: { type: 'object', properties: { text: { type: 'string', minLength: 1, maxLength: MAX_TEXT }, limitations: { type: 'array', items: { type: 'string', minLength: 1, maxLength: MAX_ITEM }, maxItems: 16 } }, required: ['text'], additionalProperties: false },
        },
        async execute(raw) {
          const args = parseObject(raw);
          const text = requiredString(args.text, MAX_TEXT);
          const limitations = optionalStrings(args.limitations, MAX_ITEM);
          return { content: '已提交最终结果候选，等待 Host Settlement。', details: { type: 'settlement_proposal', proposal: { kind: 'submit', text, ...(limitations ? { limitations } : {}) } } };
        },
      },
      {
        definition: {
          name: 'report_blocked',
          description: '报告当前确实无法继续的阻塞；必须说明原因和已尝试事项。',
          parameters: { type: 'object', properties: { reason: { type: 'string', minLength: 1, maxLength: MAX_ITEM }, attempts: { type: 'array', items: { type: 'string', minLength: 1, maxLength: MAX_ITEM }, minItems: 1, maxItems: 16 }, needsUser: { type: 'string', maxLength: MAX_ITEM } }, required: ['reason', 'attempts'], additionalProperties: false },
        },
        async execute(raw) {
          const args = parseObject(raw);
          const reason = requiredString(args.reason, MAX_ITEM);
          const attempts = optionalStrings(args.attempts, MAX_ITEM) ?? [];
          if (!attempts.length) throw new Error('CONTROL_ATTEMPTS_REQUIRED');
          const needsUser = args.needsUser === undefined ? undefined : requiredString(args.needsUser, MAX_ITEM);
          return { content: '已提交阻塞候选，等待 Host Settlement。', details: { type: 'settlement_proposal', proposal: { kind: 'blocked', reason, attempts, ...(needsUser ? { needsUser } : {}) } } };
        },
      },
      {
        definition: {
          name: 'propose_replan',
          description: '在当前策略失败或无进展时提出有变化的下一策略；不会执行工具或改变终态。',
          parameters: { type: 'object', properties: { strategyRevision: { type: 'integer', minimum: 1 }, summary: { type: 'string', minLength: 1, maxLength: MAX_ITEM }, nextStep: { type: 'string', minLength: 1, maxLength: MAX_ITEM }, abandonedAssumption: { type: 'string', maxLength: MAX_ITEM } }, required: ['strategyRevision', 'summary', 'nextStep'], additionalProperties: false },
        },
        async execute(raw) {
          const args = parseObject(raw);
          if (!Number.isInteger(args.strategyRevision) || (args.strategyRevision as number) < 1) throw new Error('CONTROL_ARGUMENTS_INVALID');
          const summary = requiredString(args.summary, MAX_ITEM);
          const nextStep = requiredString(args.nextStep, MAX_ITEM);
          const abandonedAssumption = args.abandonedAssumption === undefined ? undefined : requiredString(args.abandonedAssumption, MAX_ITEM);
          return { content: '已提交重规划候选，等待 Runtime 校验策略变化。', details: { type: 'replan_proposal', strategyRevision: args.strategyRevision as number, summary, nextStep, ...(abandonedAssumption ? { abandonedAssumption } : {}) } };
        },
      },
    ],
  };
}

function parseObject(raw: string): Record<string, unknown> {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CONTROL_ARGUMENTS_INVALID');
  return value as Record<string, unknown>;
}
function requiredString(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('CONTROL_ARGUMENTS_INVALID');
  return value.trim();
}
function optionalStrings(value: unknown, max: number): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 16) throw new Error('CONTROL_ARGUMENTS_INVALID');
  return value.map(item => requiredString(item, max));
}

import type { ToolCapability } from './types.js';
import { randomUUID } from 'node:crypto';

const MAX_TEXT = 12000;
const MAX_ITEM = 1000;

export function createControlCapability(): ToolCapability {
  return {
    id: 'control',
    instructions: 'Host 控制面：提交最终候选结果或报告当前阻塞。调用只产生提案，最终状态由 Runtime 判定。',
    tools: [
      {
        definition: {
          name: 'propose_work_plan',
          description: '在 Plan 模式提交待用户审批的完整工作计划。只提供目标和步骤结构；Runtime 生成 planId/revision 并将全部步骤初始化为 pending。不要提交步骤状态或证据。成功后本 Turn 会暂停等待用户批准。',
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['goal','steps','verification'],
            properties: {
              goal: { type: 'string' },
              constraints: { type: 'array', items: { type: 'string' } },
              assumptions: { type: 'array', items: { type: 'string' } },
              steps: {
                type: 'array',
                minItems: 1,
                maxItems: 32,
                items: {
                  type: 'object', additionalProperties: false,
                  required: ['id','title','kind','dependencies'],
                  properties: {
                    id: { type: 'string' }, title: { type: 'string' },
                    dependencies: { type: 'array', items: { type: 'string' } },
                    kind: { type: 'string', enum: ['inspect','change','verify','other'] },
                  },
                },
              },
              risks: { type: 'array', items: { type: 'string' } },
              verification: { type: 'array', items: { type: 'string' } },
              openQuestions: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        async execute(raw) {
          const args = parseObject(raw);
          rejectUnknownKeys(args, ['goal','constraints','assumptions','steps','risks','verification','openQuestions']);
          const goal = requiredString(args.goal, MAX_ITEM);
          if (!Array.isArray(args.steps) || args.steps.length < 1 || args.steps.length > 32) throw new Error('WORK_PLAN_STEPS_INVALID');
          const steps = args.steps.map(value => {
            if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('WORK_PLAN_STEP_INVALID');
            const step = value as Record<string, unknown>;
            rejectUnknownKeys(step, ['id','title','kind','dependencies']);
            if (!Array.isArray(step.dependencies) || !['inspect','change','verify','other'].includes(String(step.kind))) throw new Error('WORK_PLAN_STEP_INVALID');
            return {
              id: requiredString(step.id, 128),
              title: requiredString(step.title, MAX_ITEM),
              kind: step.kind as import('../core/work-plan.js').WorkPlanStepKind,
              dependencies: optionalStrings(step.dependencies, 128) ?? [],
              status: 'pending' as const,
            };
          });
          const verification = optionalStrings(args.verification, MAX_ITEM);
          if (!verification?.length) throw new Error('WORK_PLAN_VERIFICATION_REQUIRED');
          const list = (key: 'constraints'|'assumptions'|'risks'|'openQuestions', fallback: readonly string[] = []): readonly string[] => optionalStrings(args[key], MAX_ITEM) ?? fallback;
          const plan: import('../core/work-plan.js').WorkPlanV1 = {
            version: 1, planId: randomUUID(), revision: 0, goal,
            constraints: list('constraints'), assumptions: list('assumptions'), steps,
            risks: list('risks'), verification, openQuestions: list('openQuestions'),
            status: 'active', updatedAt: new Date().toISOString(),
          };
          return { content: 'Plan proposal submitted; Runtime will validate it and wait for explicit user approval.', details: { type: 'work_plan_proposal', plan } };
        },
      },
      {
        definition: {
          name: 'update_work_plan_progress',
          description: 'Act 模式只更新一个已批准计划步骤的状态。completed/blocked 必须引用可验证的真实 Tool Call ID；Runtime 检查证据、依赖和状态迁移。',
          parameters: {
            type: 'object', additionalProperties: false,
            required: ['stepId','stepStatus'],
            properties: {
              stepId: { type: 'string' },
              stepStatus: { type: 'string', enum: ['in_progress','completed','blocked'] },
              evidenceCallIds: { type: 'array', items: { type: 'string' }, uniqueItems: true },
            },
          },
        },
        async execute(raw) {
          const args = parseObject(raw);
          rejectUnknownKeys(args, ['stepId','stepStatus','evidenceCallIds']);
          const stepId = requiredString(args.stepId, 128);
          const status = args.stepStatus;
          if (!['in_progress','completed','blocked'].includes(String(status))) throw new Error('WORK_PLAN_PROGRESS_INVALID');
          const evidenceCallIds = optionalStrings(args.evidenceCallIds, MAX_ITEM) ?? [];
          return { content: 'Work Plan progress submitted for Runtime evidence validation.', details: { type: 'work_plan_progress', stepId, status: status as import('../core/work-plan.js').WorkPlanStep['status'], evidenceCallIds } };
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
function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('CONTROL_ARGUMENTS_INVALID');
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

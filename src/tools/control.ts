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

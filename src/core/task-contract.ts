import type { Message } from './types.js';
import type { TaskStateV1 } from './task-state.js';

export type TaskContractStatus = 'active' | 'blocked' | 'completed';
export type TaskContractStepStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

export interface TaskContractStepV1 {
  readonly id: string;
  readonly title: string;
  readonly status: TaskContractStepStatus;
  readonly deliverables: readonly string[];
}

export interface TaskEvidenceRefV1 {
  readonly id: string;
  readonly kind: 'user' | 'tool' | 'verification' | 'workspace';
  readonly source: string;
}

export interface TaskContractV1 {
  readonly version: 1;
  readonly revision: number;
  readonly goal: string;
  readonly deliverables: readonly string[];
  readonly successCriteria: readonly string[];
  readonly constraints: readonly { readonly text: string; readonly sourceMessageIndex?: number }[];
  readonly assumptions: readonly string[];
  readonly openQuestions: readonly string[];
  readonly steps: readonly TaskContractStepV1[];
  readonly evidence: readonly TaskEvidenceRefV1[];
  readonly blockers: readonly string[];
  readonly status: TaskContractStatus;
  readonly updatedAt: string;
}

export class TaskContractValidationError extends Error {
  readonly code = 'TASK_CONTRACT_INVALID' as const;
}

const MAX_ITEMS = 32;
const MAX_TEXT = 1000;

export function validateTaskContract(contract: TaskContractV1, messages?: readonly Message[]): TaskContractV1 {
  if (contract.version !== 1 || !Number.isInteger(contract.revision) || contract.revision < 0) invalid('contract version/revision 无效');
  text(contract.goal, 'goal');
  for (const [name, items] of Object.entries({ deliverables: contract.deliverables, successCriteria: contract.successCriteria, assumptions: contract.assumptions, openQuestions: contract.openQuestions, blockers: contract.blockers })) {
    if (!Array.isArray(items) || items.length > MAX_ITEMS) invalid(`${name} 数量无效`);
    items.forEach(item => text(item, name));
  }
  if (!Array.isArray(contract.constraints) || contract.constraints.length > MAX_ITEMS) invalid('constraints 数量无效');
  for (const constraint of contract.constraints) {
    text(constraint.text, 'constraint');
    if (constraint.sourceMessageIndex !== undefined && (!Number.isInteger(constraint.sourceMessageIndex) || constraint.sourceMessageIndex < 0 || (messages && messages[constraint.sourceMessageIndex]?.role !== 'user'))) invalid('constraint sourceMessageIndex 无效');
  }
  if (!Array.isArray(contract.steps) || contract.steps.length > MAX_ITEMS) invalid('steps 数量无效');
  const ids = new Set<string>(); let inProgress = 0; let incomplete = 0;
  for (const step of contract.steps) {
    text(step.id, 'step.id'); text(step.title, 'step.title');
    if (ids.has(step.id) || !['pending', 'in_progress', 'completed', 'blocked'].includes(step.status)) invalid('step id/status 无效');
    ids.add(step.id); if (step.status === 'in_progress') inProgress += 1; if (step.status !== 'completed') incomplete += 1;
    if (!Array.isArray(step.deliverables) || step.deliverables.length > MAX_ITEMS) invalid('step deliverables 无效');
    step.deliverables.forEach((item: string) => text(item, 'step.deliverable'));
  }
  if (inProgress > 1) invalid('同时只能有一个 in_progress step');
  if (!Array.isArray(contract.evidence) || contract.evidence.length > MAX_ITEMS) invalid('evidence 数量无效');
  for (const ref of contract.evidence) { text(ref.id, 'evidence.id'); text(ref.source, 'evidence.source'); if (!['user', 'tool', 'verification', 'workspace'].includes(ref.kind)) invalid('evidence.kind 无效'); }
  if (!['active', 'blocked', 'completed'].includes(contract.status)) invalid('status 无效');
  if (contract.status === 'completed' && (incomplete > 0 || contract.blockers.length > 0 || contract.openQuestions.length > 0)) invalid('completed contract 不能包含未完成事项');
  if (contract.status === 'blocked' && contract.blockers.length === 0 && contract.openQuestions.length === 0) invalid('blocked contract 必须包含 blocker 或 openQuestion');
  return contract;
}

export function migrateTaskStateToContract(state: TaskStateV1, now = state.updatedAt): TaskContractV1 {
  return validateTaskContract({ version: 1, revision: state.revision, goal: state.goal, deliverables: [], successCriteria: [], constraints: state.constraints, assumptions: state.assumptions, openQuestions: state.openQuestions, steps: state.steps.map(step => ({ ...step, deliverables: [] })), evidence: [], blockers: state.blockers, status: state.status, updatedAt: now });
}

function text(value: string, field: string): void { if (typeof value !== 'string' || !value.trim()) invalid(`${field} 必须是非空字符串`); if (value.length > MAX_TEXT) invalid(`${field} 超出长度限制`); }
function invalid(message: string): never { throw new TaskContractValidationError(message); }

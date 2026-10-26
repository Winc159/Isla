import type { FailureCategory, FailureRecord } from './failure-ledger.js';

export type RecoveryAction = 'retry_same' | 'retry_after_observation' | 'replan' | 'request_user' | 'pause' | 'block' | 'fail' | 'cancel';

export function chooseRecovery(failure: FailureRecord, history: readonly FailureRecord[]): RecoveryAction {
  if (failure.category === 'cancelled') return 'cancel';
  if (failure.category === 'permission') return 'request_user';
  if (failure.category === 'unknown_outcome') return 'retry_after_observation';
  const same = history.filter(item => item.actionSignature === failure.actionSignature && item.code === failure.code).length;
  if (same >= 2) return 'replan';
  if (failure.category === 'transient_provider') return 'retry_same';
  if (failure.category === 'verification' || failure.category === 'invalid_action' || failure.category === 'strategy') return 'replan';
  return 'retry_after_observation';
}

export function recoveryObservation(action: RecoveryAction, category: FailureCategory): string {
  const text: Record<RecoveryAction, string> = {
    retry_same: '这是可恢复的临时失败，允许有限重试。',
    retry_after_observation: '结果尚不确定，先读取事实状态，再决定下一步；不要重放未知副作用。',
    replan: '当前策略没有产生进展，必须改变工具、参数或验证路径后再继续。',
    request_user: '继续需要用户提供授权、凭据或业务选择。',
    pause: '预算已用尽，保存检查点并暂停。',
    block: '外部条件当前不满足，暂时无法继续。',
    fail: '当前能力或约束无法实现目标。',
    cancel: '当前回合已取消，不得继续执行。',
  };
  return `[recovery:${category}] ${text[action]}`;
}

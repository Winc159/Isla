export type FailureCategory = 'invalid_action' | 'transient_provider' | 'environment' | 'permission' | 'verification' | 'strategy' | 'external_state' | 'unknown_outcome' | 'cancelled';

export interface FailureRecord {
  readonly id: string;
  readonly category: FailureCategory;
  readonly actionSignature: string;
  readonly code: string;
  readonly summary: string;
  readonly step: number;
  readonly createdAt: string;
}

export function classifyFailure(code: string, detail = ''): FailureCategory {
  if (code === 'TURN_CANCELLED') return 'cancelled';
  if (code === 'USER_REJECTED' || code === 'PERMISSION_DENIED') return 'permission';
  if (/TIMEOUT|NETWORK|RATE_LIMIT/iu.test(code)) return 'transient_provider';
  if (/VERIFICATION|TEST|BUILD/iu.test(code) || /verification/iu.test(detail)) return 'verification';
  if (/UNKNOWN|ABORT/iu.test(code)) return 'unknown_outcome';
  if (/ARGUMENT|INVALID|NOT_FOUND/iu.test(code)) return 'invalid_action';
  return 'environment';
}

export function createFailureRecord(input: { readonly code: string; readonly detail?: string; readonly action: string; readonly step: number; readonly now?: string }): FailureRecord {
  const summary = (input.detail ?? input.code).replace(/[\r\n\t]+/gu, ' ').slice(0, 500);
  const actionSignature = input.action.replace(/[\r\n\t]+/gu, ' ').slice(0, 500);
  return { id: `${input.step}-${simpleHash(`${input.code}:${actionSignature}:${summary}`)}`, category: classifyFailure(input.code, summary), actionSignature, code: input.code.slice(0, 120), summary, step: input.step, createdAt: input.now ?? new Date().toISOString() };
}

function simpleHash(value: string): string { let hash = 2166136261; for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619); return (hash >>> 0).toString(16).padStart(8, '0'); }

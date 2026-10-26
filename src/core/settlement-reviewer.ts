export type ReviewerDecision = 'accept' | 'continue' | 'needs_user' | 'blocked';
export interface SettlementReview {
  readonly decision: ReviewerDecision;
  readonly missingCriteria: readonly string[];
  readonly unsupportedClaims: readonly string[];
  readonly questionReason?: string;
  readonly blockerReason?: string;
}

export function parseSettlementReview(value: unknown): SettlementReview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('REVIEWER_OUTPUT_INVALID');
  const item = value as Record<string, unknown>;
  if (!['accept', 'continue', 'needs_user', 'blocked'].includes(String(item.decision))) throw new Error('REVIEWER_OUTPUT_INVALID');
  const list = (key: string): readonly string[] => {
    const raw = item[key];
    if (raw === undefined) return [];
    if (!Array.isArray(raw) || raw.length > 32 || raw.some(entry => typeof entry !== 'string' || !entry.trim() || entry.length > 500)) throw new Error('REVIEWER_OUTPUT_INVALID');
    return raw.map(entry => (entry as string).trim());
  };
  const result: SettlementReview = { decision: item.decision as ReviewerDecision, missingCriteria: list('missingCriteria'), unsupportedClaims: list('unsupportedClaims') };
  for (const key of ['questionReason', 'blockerReason'] as const) if (item[key] !== undefined && (typeof item[key] !== 'string' || (item[key] as string).length > 1000)) throw new Error('REVIEWER_OUTPUT_INVALID');
  return { ...result, ...(typeof item.questionReason === 'string' && item.questionReason.trim() ? { questionReason: item.questionReason.trim() } : {}), ...(typeof item.blockerReason === 'string' && item.blockerReason.trim() ? { blockerReason: item.blockerReason.trim() } : {}) };
}

export function reviewerMayAccept(review: SettlementReview, deterministicAccepted: boolean): boolean {
  return deterministicAccepted && review.decision === 'accept' && review.missingCriteria.length === 0 && review.unsupportedClaims.length === 0;
}

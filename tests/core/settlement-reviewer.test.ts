import { describe, expect, it } from 'vitest';
import { parseSettlementReview, reviewerMayAccept } from '../../src/core/settlement-reviewer.js';
import { createEvidenceRecord, invalidateWorkspaceEvidence } from '../../src/core/evidence-ledger.js';

describe('settlement reviewer and evidence ledger', () => {
  it('accepts only bounded structured reviewer output after deterministic gates', () => {
    const review = parseSettlementReview({ decision: 'accept', missingCriteria: [], unsupportedClaims: [] });
    expect(reviewerMayAccept(review, true)).toBe(true);
    expect(reviewerMayAccept(review, false)).toBe(false);
    expect(() => parseSettlementReview({ decision: 'accept', missingCriteria: ['x'.repeat(501)], unsupportedClaims: [] })).toThrow();
  });
  it('invalidates verification facts after a workspace mutation', () => {
    const record = createEvidenceRecord({ turnId: 't1', kind: 'verification', source: 'run_command:1', claim: 'tests passed', status: 'valid', path: 'README.md' });
    expect(invalidateWorkspaceEvidence([record], 'README.md')[0]?.status).toBe('invalidated');
  });
});

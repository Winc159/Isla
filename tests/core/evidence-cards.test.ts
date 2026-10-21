import { describe, expect, it } from 'vitest';
import { buildEvidenceCards, renderEvidenceCards } from '../../src/core/evidence-cards.js';

describe('evidence cards', () => {
  it('creates a high-confidence file card with a locator', () => {
    const cards = buildEvidenceCards({ id: '1', name: 'read_text_file', arguments: JSON.stringify({ path: 'package.json' }) }, { ok: true, content: '{}' });
    expect(cards[0]).toMatchObject({ kind: 'file', locator: 'package.json', status: 'confirmed', confidence: 'high' });
    expect(renderEvidenceCards(cards)).toContain('[[evidence_cards]]');
  });
  it('preserves failed tool evidence as failed, not as a fact', () => {
    const cards = buildEvidenceCards({ id: '1', name: 'read_text_file', arguments: '{}' }, { ok: false, code: 'SANDBOX_DENIED', message: 'denied' });
    expect(cards[0]).toMatchObject({ status: 'failed', claim: 'denied' });
  });
});

import { describe, expect, it } from 'vitest';
import { CredentialApprovalStore } from '../src/browser/credential-approval.js';
describe('credential approval', () => {
  it('supports y/n/other without accepting secret values', () => {
    const store = new CredentialApprovalStore();
    const request = store.create({ origin: 'https://example.com', purpose: 'sign in', label: 'main', usernameHint: 'u***' });
    expect(request.status).toBe('pending');
    expect(store.decide(request.id, 'y').status).toBe('approved');
    expect(() => store.decide(request.id, 'n')).toThrow('ALREADY_DECIDED');
    const other = store.create({ origin: 'https://example.com', purpose: 'sign in' });
    expect(store.decide(other.id, 'other').status).toBe('manual');
  });
});

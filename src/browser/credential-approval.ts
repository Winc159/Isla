import { randomUUID } from 'node:crypto';
export type CredentialDecision = 'approved' | 'denied' | 'manual';
export interface CredentialRequest { readonly id: string; readonly origin: string; readonly purpose: string; readonly label?: string; readonly usernameHint?: string; readonly status: 'pending' | CredentialDecision; }

export class CredentialApprovalStore {
  private readonly requests = new Map<string, CredentialRequest>();
  create(input: Omit<CredentialRequest, 'id' | 'status'>): CredentialRequest { const request = { ...input, id: `cred_${randomUUID()}`, status: 'pending' as const }; this.requests.set(request.id, request); return request; }
  get(id: string): CredentialRequest { const request = this.requests.get(id); if (!request) throw new Error('CREDENTIAL_REQUEST_NOT_FOUND'); return request; }
  decide(id: string, decision: 'y' | 'n' | 'other'): CredentialRequest { const current = this.get(id); if (current.status !== 'pending') throw new Error('CREDENTIAL_REQUEST_ALREADY_DECIDED'); const status = decision === 'y' ? 'approved' : decision === 'n' ? 'denied' : 'manual'; const next = { ...current, status } as CredentialRequest; this.requests.set(id, next); return next; }
}

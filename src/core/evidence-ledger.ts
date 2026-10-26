export type EvidenceKind = 'tool' | 'workspace' | 'verification' | 'user' | 'external';
export type EvidenceStatus = 'valid' | 'invalidated' | 'failed';
export interface EvidenceRecord { readonly id: string; readonly turnId: string; readonly kind: EvidenceKind; readonly source: string; readonly claim: string; readonly status: EvidenceStatus; readonly createdAt: string; readonly path?: string; readonly exitCode?: number | null; readonly url?: string; }

export function createEvidenceRecord(input: Omit<EvidenceRecord, 'id' | 'createdAt'> & { readonly now?: string }): EvidenceRecord {
  const claim = input.claim.replace(/[\r\n\t]+/gu, ' ').slice(0, 500);
  const source = input.source.replace(/[\r\n\t]+/gu, ' ').slice(0, 300);
  const id = `${input.turnId}:${simpleHash(`${input.kind}:${source}:${claim}`)}`;
  return { ...input, id, source, claim, createdAt: input.now ?? new Date().toISOString(), ...(input.path ? { path: input.path.replace(/[\r\n\t]+/gu, ' ').slice(0, 500) } : {}) };
}

export function invalidateWorkspaceEvidence(records: readonly EvidenceRecord[], path?: string): readonly EvidenceRecord[] {
  return records.map(record => record.kind === 'verification' && (!path || record.path === path) && record.status === 'valid' ? { ...record, status: 'invalidated' } : record);
}
function simpleHash(value: string): string { let hash = 2166136261; for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619); return (hash >>> 0).toString(16).padStart(8, '0'); }

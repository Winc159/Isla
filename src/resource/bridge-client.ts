import { createHash } from 'node:crypto';
import { RESOURCE_JOB_STATUSES, type CreateResourceJobRequestV1, type ResourceJobStatusV1 } from './contracts.js';

const MAX_RESPONSE_BYTES = 1024 * 1024;
const SAFE_CODES = new Set(['JOB_NOT_FOUND', 'JOB_NOT_WAITING_USER', 'JOB_REVISION_STALE', 'DECISION_STALE', 'DESTINATION_ROOT_INVALID', 'MANAGED_ROOT_INVALID', 'ARCHIVE_PATH_OUTSIDE_ROOT', 'RESOURCE_REQUEST_FAILED', 'IDEMPOTENCY_CONFLICT']);

export class ResourceBridgeClient {
  private available = false;
  private failureCode = 'RESOURCE_UNAVAILABLE';
  constructor(private readonly endpoint: string, private readonly token: string, private readonly timeoutMs = 5_000) {}

  get isAvailable(): boolean { return this.available; }
  get unavailableReason(): string { return this.failureCode; }

  async health(signal?: AbortSignal): Promise<boolean> {
    try { const value = await this.request('/api/v1/resource/health', undefined, signal); this.available = isRecord(value) && value.ok === true && value.service === 'resource' && value.apiVersion === 1; this.failureCode = this.available ? '' : 'RESOURCE_PROTOCOL_INCOMPATIBLE'; }
    catch (error) { this.available = false; this.failureCode = error instanceof Error && error.message === 'RESOURCE_PROTOCOL_INCOMPATIBLE' ? error.message : 'RESOURCE_UNAVAILABLE'; }
    return this.available;
  }

  async create(input: CreateResourceJobRequestV1, sessionId: string, turnId: string, toolCallId: string, signal?: AbortSignal): Promise<SafeResourceJob> {
    const key = createHash('sha256').update(`isla-resource-job-v1\0${sessionId}\0${turnId}\0${toolCallId}`).digest('hex');
    const value = await this.request('/api/v1/resource/jobs', { method: 'POST', body: input, headers: { 'idempotency-key': key } }, signal) as { job?: unknown };
    return safeJob(requireRecord(value.job));
  }

  async get(jobId: string, signal?: AbortSignal): Promise<SafeResourceJob> { const value = await this.request(`/api/v1/resource/jobs/${encodeURIComponent(jobId)}?projection=agent`, undefined, signal) as { job?: unknown }; return safeJob(requireRecord(value.job)); }
  async list(status: ResourceJobStatusV1 | undefined, limit: number, signal?: AbortSignal): Promise<readonly SafeResourceJob[]> {
    const value = await this.request(`/api/v1/resource/jobs?projection=agent&limit=${limit}${status ? `&status=${encodeURIComponent(status)}` : ''}`, undefined, signal) as { jobs?: unknown };
    if (!Array.isArray(value.jobs)) throw new Error('RESOURCE_RESPONSE_INVALID');
    return value.jobs.filter(isRecord).map(safeJob).filter(job => !status || job.status === status).slice(0, limit);
  }
  async cancel(jobId: string, revision: number, signal?: AbortSignal): Promise<{ readonly accepted: boolean; readonly job: SafeResourceJob }> {
    const value = await this.request(`/api/v1/resource/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST', body: { expectedRevision: revision } }, signal) as { accepted?: unknown };
    return { accepted: value.accepted === true, job: await this.get(jobId, signal) };
  }
  async respond(jobId: string, decision: { readonly decisionId: string; readonly revision: number; readonly action: 'approve' | 'reject' | 'replace_input' | 'choose_destination'; readonly values?: Record<string, unknown> }, signal?: AbortSignal): Promise<{ readonly accepted: boolean; readonly job: SafeResourceJob }> {
    const current = await this.get(jobId, signal);
    if (current.revision !== decision.revision) throw new Error('JOB_REVISION_STALE');
    if (!current.pendingDecision || current.pendingDecision.id !== decision.decisionId || !current.pendingDecision.actions.includes(decision.action)) throw new Error('DECISION_STALE');
    const value = await this.request(`/api/v1/resource/jobs/${encodeURIComponent(jobId)}/confirm`, { method: 'POST', body: decision }, signal) as { accepted?: unknown };
    return { accepted: value.accepted === true, job: await this.get(jobId, signal) };
  }
  async artifact(jobId: string, artifactId: string, signal?: AbortSignal): Promise<SafeResourceArtifact> {
    const value = await this.request(`/api/v1/resource/jobs/${encodeURIComponent(jobId)}/tree?artifactId=${encodeURIComponent(artifactId)}`, undefined, signal) as { tree?: unknown };
    if (!Array.isArray(value.tree)) throw new Error('RESOURCE_RESPONSE_INVALID');
    const artifact = value.tree.find(item => isRecord(item) && item.id === artifactId);
    if (!isRecord(artifact)) throw new Error('ARTIFACT_NOT_FOUND');
    return safeArtifact(artifact);
  }

  private async request(path: string, options?: { readonly method: 'POST'; readonly body: unknown; readonly headers?: Record<string, string> }, signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs); timeout.unref();
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    try {
      if (signal?.aborted) throw new Error('TURN_CANCELLED');
      const response = await fetch(new URL(path, this.endpoint), { method: options?.method ?? 'GET', headers: { authorization: `Bearer ${this.token}`, ...(options ? { 'content-type': 'application/json', ...options.headers } : {}) }, ...(options ? { body: JSON.stringify(options.body) } : {}), signal: controller.signal });
      const contentLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) throw new Error('RESOURCE_RESPONSE_TOO_LARGE');
      if (!response.body) throw new Error('RESOURCE_RESPONSE_INVALID');
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
      try { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('RESOURCE_RESPONSE_TOO_LARGE'); } chunks.push(part.value); } }
      finally { reader.releaseLock(); }
      const text = new TextDecoder().decode(concat(chunks, bytes));
      let value: unknown;
      try { value = JSON.parse(text); } catch { throw new Error('RESOURCE_RESPONSE_INVALID'); }
      if (!response.ok) {
        const code = isRecord(value) && isRecord(value.error) && typeof value.error.code === 'string' ? value.error.code : 'RESOURCE_REQUEST_FAILED';
        throw new Error(SAFE_CODES.has(code) ? code : response.status === 401 ? 'RESOURCE_UNAUTHORIZED' : 'RESOURCE_REQUEST_FAILED');
      }
      if (path === '/api/v1/resource/health' && isRecord(value) && value.service === 'resource' && value.apiVersion !== 1) throw new Error('RESOURCE_PROTOCOL_INCOMPATIBLE');
      return value;
    } catch (error) {
      if (error instanceof Error && /^(RESOURCE_|JOB_|DECISION_|DESTINATION_|MANAGED_|ARCHIVE_|ARTIFACT_|IDEMPOTENCY_)/u.test(error.message)) throw error;
      if (signal?.aborted) throw new Error('TURN_CANCELLED');
      if (timedOut) throw new Error('RESOURCE_TIMEOUT');
      throw new Error('RESOURCE_UNAVAILABLE');
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
  }
}

export interface SafeResourceJob {
  readonly id: string; readonly revision: number; readonly status: ResourceJobStatusV1; readonly stage: string; readonly destinationRootId: string;
  readonly createdAt: string; readonly updatedAt: string; readonly progress: { readonly ratio?: number; readonly completedBytes?: number; readonly totalBytes?: number }; readonly artifacts: readonly SafeResourceArtifact[];
  readonly pendingDecision?: { readonly id: string; readonly type: string; readonly actions: readonly string[] };
  readonly failure?: { readonly code: string; readonly retryable: boolean; readonly resumeStage?: string };
}
export interface SafeResourceArtifact { readonly id: string; readonly kind: string; readonly path?: string; readonly sizeBytes?: number; readonly status: string; readonly parentId?: string; }

function safeJob(value: Record<string, unknown>): SafeResourceJob {
  if (typeof value.id !== 'string' || !value.id || value.id.length > 128 || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1 || typeof value.status !== 'string' || !(RESOURCE_JOB_STATUSES as readonly string[]).includes(value.status) || typeof value.stage !== 'string' || typeof value.destinationRootId !== 'string' || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') throw new Error('RESOURCE_RESPONSE_INVALID');
  const progress = isRecord(value.progress) ? value.progress : {};
  const decision = isRecord(value.pendingDecision) ? value.pendingDecision : undefined;
  const failure = isRecord(value.failure) ? value.failure : undefined;
  const artifacts = Array.isArray(value.artifacts) ? value.artifacts.filter(isRecord).slice(0, 20).map(safeArtifact) : [];
  return {
    id: stringValue(value.id), revision: numberValue(value.revision), status: value.status as ResourceJobStatusV1, stage: stringValue(value.stage), destinationRootId: stringValue(value.destinationRootId), createdAt: stringValue(value.createdAt), updatedAt: stringValue(value.updatedAt),
    progress: { ...(isNumber(progress.ratio) ? { ratio: progress.ratio } : {}), ...(isNumber(progress.completedBytes) ? { completedBytes: progress.completedBytes } : {}), ...(isNumber(progress.totalBytes) ? { totalBytes: progress.totalBytes } : {}) },
    artifacts,
    ...(decision && typeof decision.id === 'string' && typeof decision.type === 'string' && Array.isArray(decision.actions) ? { pendingDecision: { id: decision.id, type: decision.type, actions: decision.actions.filter((item): item is string => typeof item === 'string').slice(0, 8) } } : {}),
    ...(failure && typeof failure.code === 'string' && typeof failure.retryable === 'boolean' ? { failure: { code: failure.code, retryable: failure.retryable, ...(typeof failure.resumeStage === 'string' ? { resumeStage: failure.resumeStage } : {}) } } : {}),
  };
}
function safeArtifact(value: Record<string, unknown>): SafeResourceArtifact { const path = typeof value.path === 'string' && !/^(?:[A-Za-z]:[\\/]|[\\/])/u.test(value.path) && !value.path.split(/[\\/]/u).includes('..') ? value.path.slice(0, 1024) : undefined; return { id: stringValue(value.id), kind: stringValue(value.kind), ...(path ? { path } : {}), ...(isNumber(value.sizeBytes) ? { sizeBytes: value.sizeBytes } : {}), status: stringValue(value.status), ...(typeof value.parentId === 'string' ? { parentId: value.parentId } : {}) }; }
function requireRecord(value: unknown): Record<string, unknown> { if (!isRecord(value)) throw new Error('RESOURCE_RESPONSE_INVALID'); return value; }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function stringValue(value: unknown): string { return typeof value === 'string' ? value.slice(0, 256) : ''; }
function numberValue(value: unknown): number { return isNumber(value) ? value : 0; }
function isNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function concat(chunks: readonly Uint8Array[], size: number): Uint8Array { const output = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; } return output; }

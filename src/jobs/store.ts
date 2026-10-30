import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { JOB_STATUSES, type CreateJobInputV1, type JobLeaseV1, type JobStatus, type JobUpdateV1, type JobV1 } from './types.js';

const terminal = new Set<JobStatus>(['completed', 'failed', 'cancelled']);

export class JobStore {
  readonly path: string;
  private readonly db: DatabaseSync;

  constructor(path = defaultJobDatabasePath()) {
    this.path = path;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path, { enableForeignKeyConstraints: true, timeout: 5_000, allowExtension: false, defensive: true });
    this.db.exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL,
        idempotency_key TEXT, input_ref TEXT NOT NULL, status TEXT NOT NULL, progress_json TEXT,
        attempt INTEGER NOT NULL, max_attempts INTEGER NOT NULL, waiting_user_json TEXT,
        artifacts_json TEXT NOT NULL, result_json TEXT, error_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(owner_kind, owner_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS jobs_status_created_idx ON jobs(status, created_at);
      CREATE TABLE IF NOT EXISTS job_leases (
        job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL, expires_at TEXT NOT NULL, heartbeat_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS job_payloads (
        job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
        payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS job_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        type TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL
      );`);
  }

  close(): void { this.db.close(); }

  create(input: CreateJobInputV1): JobV1 {
    validateCreate(input);
    const now = new Date().toISOString();
    const record: JobV1 = { version: 1, id: randomUUID(), type: input.type, owner: input.owner,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}), inputRef: input.inputRef,
      status: 'queued', attempt: 0, maxAttempts: input.maxAttempts ?? 3, artifacts: [], createdAt: now, updatedAt: now };
    try {
      this.db.exec('BEGIN IMMEDIATE');
      this.db.prepare(`INSERT INTO jobs(id,type,owner_kind,owner_id,idempotency_key,input_ref,status,attempt,max_attempts,artifacts_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(record.id, record.type, record.owner.kind, record.owner.id, record.idempotencyKey ?? null, record.inputRef, record.status, record.attempt, record.maxAttempts, '[]', now, now);
      if (input.payload !== undefined) this.db.prepare('INSERT INTO job_payloads(job_id,payload_json) VALUES(?,?)').run(record.id, JSON.stringify(input.payload));
      this.event(record.id, 'job.created', { status: 'queued' });
      this.db.exec('COMMIT');
      return record;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* failed before the transaction was opened */ }
      if (input.idempotencyKey && isConstraint(error)) {
        const existing = this.db.prepare('SELECT * FROM jobs WHERE owner_kind=? AND owner_id=? AND idempotency_key=?').get(input.owner.kind, input.owner.id, input.idempotencyKey) as JobRow | undefined;
        if (existing) return toJob(existing);
      }
      throw error;
    }
  }

  get(id: string): JobV1 | undefined { const row = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as JobRow | undefined; return row ? toJob(row) : undefined; }
  payload(id: string): unknown { const row = this.db.prepare('SELECT payload_json FROM job_payloads WHERE job_id=?').get(id) as { payload_json?: string } | undefined; return row?.payload_json === undefined ? undefined : JSON.parse(row.payload_json) as unknown; }
  setPayload(id: string, payload: unknown): void { const serialized = JSON.stringify(payload); if (serialized === undefined || Buffer.byteLength(serialized) > 128 * 1024) throw new Error('JOB_PAYLOAD_INVALID'); const result = this.db.prepare('UPDATE job_payloads SET payload_json=? WHERE job_id=?').run(serialized, id); if (Number(result.changes) !== 1) throw new Error('JOB_NOT_FOUND'); }
  list(options: { readonly ownerId?: string; readonly status?: JobStatus; readonly limit?: number } = {}): readonly JobV1[] {
    const limit = options.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('JOB_LIMIT_INVALID');
    const rows = this.db.prepare(`SELECT * FROM jobs WHERE (? IS NULL OR owner_id=?) AND (? IS NULL OR status=?) ORDER BY created_at DESC LIMIT ?`)
      .all(options.ownerId ?? null, options.ownerId ?? null, options.status ?? null, options.status ?? null, limit) as unknown as JobRow[];
    return rows.map(toJob);
  }
  events(id: string, after = 0, limit = 100): readonly JobEventV1[] {
    const rows = this.db.prepare('SELECT sequence,job_id,type,data_json,created_at FROM job_events WHERE job_id=? AND sequence>? ORDER BY sequence LIMIT ?').all(id, after, Math.min(500, Math.max(1, limit))) as unknown as JobEventRow[];
    return rows.map(row => ({ sequence: row.sequence, jobId: row.job_id, type: row.type, data: JSON.parse(row.data_json) as unknown, createdAt: row.created_at }));
  }

  claim(id: string, ownerId: string, leaseMs: number, now = Date.now()): JobLeaseV1 | undefined {
    if (!Number.isInteger(leaseMs) || leaseMs < 100 || leaseMs > 300_000) throw new Error('JOB_LEASE_DURATION_INVALID');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT status FROM jobs WHERE id=?').get(id) as { status?: JobStatus } | undefined;
      const lease = this.db.prepare('SELECT owner_id,expires_at FROM job_leases WHERE job_id=?').get(id) as { owner_id: string; expires_at: string } | undefined;
      if (!row || row.status !== 'queued' && row.status !== 'running' || lease && Date.parse(lease.expires_at) > now && lease.owner_id !== ownerId) { this.db.exec('ROLLBACK'); return undefined; }
      const acquiredAt = new Date(now).toISOString(); const expiresAt = new Date(now + leaseMs).toISOString();
      this.db.prepare(`INSERT INTO job_leases(job_id,owner_id,expires_at,heartbeat_at) VALUES(?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET owner_id=excluded.owner_id,expires_at=excluded.expires_at,heartbeat_at=excluded.heartbeat_at`).run(id, ownerId, expiresAt, acquiredAt);
      const attempt = row.status === 'queued' ? 1 : (this.get(id)?.attempt ?? 0) + 1;
      this.db.prepare("UPDATE jobs SET status='running',attempt=?,updated_at=? WHERE id=?").run(attempt, acquiredAt, id);
      this.event(id, 'job.started', { ownerId, attempt });
      this.db.exec('COMMIT');
      return { jobId: id, ownerId, expiresAt, heartbeatAt: acquiredAt };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  heartbeat(id: string, ownerId: string, leaseMs: number, now = Date.now()): JobLeaseV1 | undefined {
    const heartbeatAt = new Date(now).toISOString(); const expiresAt = new Date(now + leaseMs).toISOString();
    const result = this.db.prepare('UPDATE job_leases SET heartbeat_at=?,expires_at=? WHERE job_id=? AND owner_id=? AND expires_at>?').run(heartbeatAt, expiresAt, id, ownerId, heartbeatAt);
    return Number(result.changes) === 1 ? { jobId: id, ownerId, heartbeatAt, expiresAt } : undefined;
  }

  update(id: string, ownerId: string, status: JobStatus, update: JobUpdateV1 = {}): JobV1 {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.get(id);
      if (!current) throw new Error('JOB_NOT_FOUND');
      if (terminal.has(current.status)) { if (current.status === status) { this.db.exec('COMMIT'); return current; } throw new Error('JOB_TERMINAL'); }
      if (!canTransition(current.status, status)) throw new Error('JOB_TRANSITION_INVALID');
      if (status === 'completed' || status === 'failed' || status === 'cancelled') this.db.prepare('DELETE FROM job_leases WHERE job_id=? AND owner_id=?').run(id, ownerId);
      else if (status !== 'waiting_user' && !(current.status === 'waiting_user' && status === 'queued')) {
        const lease = this.db.prepare('SELECT owner_id,expires_at FROM job_leases WHERE job_id=?').get(id) as { owner_id: string; expires_at: string } | undefined;
        if (!lease || lease.owner_id !== ownerId || Date.parse(lease.expires_at) <= Date.now()) throw new Error('JOB_LEASE_LOST');
      }
      const now = new Date().toISOString();
      this.db.prepare('UPDATE jobs SET status=?,progress_json=COALESCE(?,progress_json),waiting_user_json=?,result_json=COALESCE(?,result_json),error_code=?,updated_at=? WHERE id=?')
        .run(status, update.progress === undefined ? null : JSON.stringify(update.progress), update.waitingUser === undefined ? null : JSON.stringify(update.waitingUser), update.result === undefined ? null : JSON.stringify(update.result), update.errorCode ?? null, now, id);
      if (status === 'waiting_user') this.db.prepare('DELETE FROM job_leases WHERE job_id=? AND owner_id=?').run(id, ownerId);
      if (status === 'queued') this.db.prepare('UPDATE jobs SET waiting_user_json=NULL WHERE id=?').run(id);
      this.event(id, `job.${status}`, { ...(update.progress ? { progress: update.progress } : {}), ...(update.errorCode ? { errorCode: update.errorCode } : {}) });
      const next = this.get(id)!; this.db.exec('COMMIT'); return next;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  cancel(id: string): { readonly accepted: boolean; readonly job?: JobV1 } {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const job = this.get(id); if (!job || terminal.has(job.status)) { this.db.exec('COMMIT'); return { accepted: false, ...(job ? { job } : {}) }; }
      const now = new Date().toISOString();
      this.db.prepare("UPDATE jobs SET status='cancelled',waiting_user_json=NULL,error_code=NULL,updated_at=? WHERE id=?").run(now, id);
      this.db.prepare('DELETE FROM job_leases WHERE job_id=?').run(id); this.event(id, 'job.cancelled', {});
      const next = this.get(id)!; this.db.exec('COMMIT'); return { accepted: true, job: next };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  respond(id: string, answer: string): JobV1 {
    const normalized = answer.trim(); if (!normalized || normalized.length > 4000) throw new Error('JOB_ANSWER_INVALID');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const job = this.get(id); if (!job) throw new Error('JOB_NOT_FOUND'); if (job.status !== 'waiting_user') throw new Error('JOB_NOT_WAITING_USER');
      const existing = this.payload(id); const payload = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing as Record<string, unknown> : {};
      this.db.prepare('INSERT INTO job_payloads(job_id,payload_json) VALUES(?,?) ON CONFLICT(job_id) DO UPDATE SET payload_json=excluded.payload_json').run(id, JSON.stringify({ ...payload, userAnswer: normalized }));
      const now = new Date().toISOString(); this.db.prepare("UPDATE jobs SET status='queued',waiting_user_json=NULL,updated_at=? WHERE id=?").run(now, id);
      this.event(id, 'job.resumed', { answerLength: normalized.length }); const next = this.get(id)!; this.db.exec('COMMIT'); return next;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  recoverExpired(now = Date.now()): number {
    const rows = this.db.prepare("SELECT j.id,j.attempt,j.max_attempts FROM jobs j LEFT JOIN job_leases l ON l.job_id=j.id WHERE j.status='running' AND (l.job_id IS NULL OR l.expires_at<=?)").all(new Date(now).toISOString()) as unknown as Array<{ id: string; attempt: number; max_attempts: number }>;
    for (const row of rows) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const current = this.get(row.id); if (!current || current.status !== 'running') { this.db.exec('ROLLBACK'); continue; }
        const status: JobStatus = current.attempt < current.maxAttempts ? 'queued' : 'failed'; const updatedAt = new Date(now).toISOString();
        this.db.prepare('DELETE FROM job_leases WHERE job_id=?').run(row.id);
        this.db.prepare('UPDATE jobs SET status=?,error_code=?,updated_at=? WHERE id=?').run(status, status === 'failed' ? 'JOB_ATTEMPTS_EXHAUSTED' : null, updatedAt, row.id);
        this.event(row.id, status === 'queued' ? 'job.recovered' : 'job.failed', { code: status === 'failed' ? 'JOB_ATTEMPTS_EXHAUSTED' : 'JOB_LEASE_EXPIRED' });
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
    return rows.length;
  }

  private event(jobId: string, type: string, data: unknown): void { this.db.prepare('INSERT INTO job_events(job_id,type,data_json,created_at) VALUES(?,?,?,?)').run(jobId, type, JSON.stringify(data), new Date().toISOString()); }
}

export interface JobEventV1 { readonly sequence: number; readonly jobId: string; readonly type: string; readonly data: unknown; readonly createdAt: string; }
export function defaultJobDatabasePath(): string { return join(homedir(), '.isla', 'jobs.sqlite'); }
function canTransition(from: JobStatus, to: JobStatus): boolean { return from === 'queued' && (to === 'running' || to === 'cancelled') || from === 'running' && ['waiting_user','completed','failed','cancelled','queued'].includes(to) || from === 'waiting_user' && (to === 'queued' || to === 'cancelled'); }
function validateCreate(input: CreateJobInputV1): void {
  if (!/^[a-z][a-z0-9._-]{0,63}$/u.test(input.type)) throw new Error('JOB_TYPE_INVALID');
  if (!input.owner || !['session','job'].includes(input.owner.kind) || !/^[A-Za-z0-9._:-]{1,200}$/u.test(input.owner.id)) throw new Error('JOB_OWNER_INVALID');
  if (input.owner.kind === 'job') throw new Error('SUBAGENT_DEPTH_EXCEEDED');
  if (!input.inputRef || input.inputRef.length > 2048 || /[\r\n\0]/u.test(input.inputRef)) throw new Error('JOB_INPUT_REF_INVALID');
  if (input.idempotencyKey !== undefined && (!input.idempotencyKey || input.idempotencyKey.length > 200)) throw new Error('JOB_IDEMPOTENCY_KEY_INVALID');
  if (input.maxAttempts !== undefined && (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 10)) throw new Error('JOB_MAX_ATTEMPTS_INVALID');
}
function isConstraint(error: unknown): boolean { return error instanceof Error && /constraint failed/iu.test(error.message); }
interface JobRow { id: string;type: string;owner_kind: 'session'|'job';owner_id: string;idempotency_key: string|null;input_ref: string;status: JobStatus;progress_json: string|null;attempt: number;max_attempts: number;waiting_user_json: string|null;artifacts_json: string;result_json: string|null;error_code: string|null;created_at: string;updated_at: string; }
interface JobEventRow { sequence: number;job_id: string;type: string;data_json: string;created_at: string; }
function toJob(row: JobRow): JobV1 { const progress = row.progress_json ? JSON.parse(row.progress_json) as NonNullable<JobV1['progress']> : undefined; return { version: 1,id:row.id,type:row.type,owner:{kind:row.owner_kind,id:row.owner_id},...(row.idempotency_key?{idempotencyKey:row.idempotency_key}:{}),inputRef:row.input_ref,status:row.status,...(progress?{progress}:{}),attempt:row.attempt,maxAttempts:row.max_attempts,...(row.waiting_user_json?{waitingUser:JSON.parse(row.waiting_user_json) as NonNullable<JobV1['waitingUser']>}:{}),artifacts:JSON.parse(row.artifacts_json) as JobV1['artifacts'],...(row.result_json?{result:JSON.parse(row.result_json) as unknown}:{}),...(row.error_code?{errorCode:row.error_code}:{}),createdAt:row.created_at,updatedAt:row.updated_at }; }

import { randomUUID } from 'node:crypto';
import type { Effect } from '../core/service-kernel.js';
import { JobStore } from './store.js';
import type { CreateJobInputV1, JobStatus, JobUpdateV1, JobV1 } from './types.js';

export interface JobHandlerContext { readonly job: JobV1; readonly signal: AbortSignal; readonly update: (status: JobStatus, value?: JobUpdateV1) => JobV1; }
export type JobHandler = (context: JobHandlerContext) => Promise<unknown>;

export class JobRuntime implements Effect {
  readonly workerId = randomUUID();
  private readonly handlers = new Map<string, JobHandler>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly active = new Map<string, Promise<void>>();
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private closed = false;
  constructor(readonly store: JobStore, private readonly options: { readonly concurrency?: number; readonly leaseMs?: number; readonly pollMs?: number } = {}) {}
  register(type: string, handler: JobHandler): void { if (this.running) throw new Error('JOB_RUNTIME_ALREADY_STARTED'); if (this.handlers.has(type)) throw new Error('JOB_HANDLER_DUPLICATE'); this.handlers.set(type, handler); }
  async start(): Promise<void> {
    if (this.running) return; this.running = true; this.store.recoverExpired();
    this.timer = setInterval(() => this.pump(), this.options.pollMs ?? 500); this.timer.unref();
    this.pump();
  }
  create(input: CreateJobInputV1): JobV1 { return this.store.create(input); }
  list(options?: { readonly ownerId?: string; readonly status?: JobStatus; readonly limit?: number }): readonly JobV1[] { return this.store.list(options); }
  get(id: string): JobV1 | undefined { return this.store.get(id); }
  payload(id: string): unknown { return this.store.payload(id); }
  setPayload(id: string, payload: unknown): void { this.store.setPayload(id, payload); }
  respond(id: string, answer: string): JobV1 { const job = this.store.respond(id, answer); this.pump(); return job; }
  events(id: string, after?: number, limit?: number) { return this.store.events(id, after, limit); }
  cancel(id: string): { readonly accepted: boolean; readonly job?: JobV1 } { const result = this.store.cancel(id); if (result.accepted) this.controllers.get(id)?.abort(); return result; }
  wake(): void { this.pump(); }
  async close(): Promise<void> {
    if (this.closed) return; this.closed = true; if (this.timer) clearInterval(this.timer);
    for (const controller of this.controllers.values()) controller.abort();
    for (const id of this.controllers.keys()) { try { this.store.update(id, this.workerId, 'queued'); } catch { /* expired lease is recovered by the next Host */ } }
    await Promise.allSettled(this.active.values());
    this.controllers.clear(); this.store.close();
  }
  private pump(): void {
    if (!this.running || this.closed) return;
    const capacity = Math.max(1, Math.min(16, this.options.concurrency ?? 2)) - this.controllers.size;
    if (capacity <= 0) return;
    const queued = this.store.list({ status: 'queued', limit: Math.min(100, capacity * 4) });
    for (const job of queued) {
      const handler = this.handlers.get(job.type); if (!handler) continue;
      const controller = new AbortController(); const lease = this.store.claim(job.id, this.workerId, this.options.leaseMs ?? 30_000);
      if (!lease) continue;
      this.controllers.set(job.id, controller);
      const running = this.run(job.id, handler, controller);
      this.active.set(job.id, running);
      void running.finally(() => this.active.delete(job.id));
    }
  }
  private async run(id: string, handler: JobHandler, controller: AbortController): Promise<void> {
    const heartbeat = setInterval(() => {
      if (!this.store.heartbeat(id, this.workerId, this.options.leaseMs ?? 30_000)) controller.abort();
    }, Math.max(100, Math.floor((this.options.leaseMs ?? 30_000) / 3))); heartbeat.unref();
    try {
      const job = this.store.get(id); if (!job) return;
      const result = await handler({ job, signal: controller.signal, update: (status, update) => this.store.update(id, this.workerId, status, update) });
      const current = this.store.get(id); if (current?.status === 'running') this.store.update(id, this.workerId, 'completed', { result });
    } catch (error) {
      const current = this.store.get(id);
      if (current?.status === 'running') {
        const retry = current.attempt < current.maxAttempts;
        this.store.update(id, this.workerId, retry ? 'queued' : 'failed', { errorCode: safeJobErrorCode(error) });
      }
    } finally { clearInterval(heartbeat); this.controllers.delete(id); this.pump(); }
  }
}

function safeJobErrorCode(error: unknown): string { return error instanceof Error && /^[A-Z][A-Z0-9_]{1,63}$/u.test(error.message) ? error.message : 'JOB_EXECUTION_FAILED'; }

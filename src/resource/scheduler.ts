import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type ResourcePool = "download" | "inspection" | "extraction" | "inference";
export type SchedulerTask<T> = (signal: AbortSignal) => Promise<T>;

export interface ResourceSchedulerOptions {
  readonly ownerId?: string;
  readonly concurrency: Readonly<Record<ResourcePool, number>>;
  readonly leaseMs?: number;
  readonly heartbeatMs?: number;
}

export class ResourceScheduler {
  private readonly ownerId: string;
  private readonly leaseMs: number;
  private readonly heartbeatMs: number;
  private readonly queues = new Map<ResourcePool, QueueItem<unknown>[]>();
  private readonly active = new Map<ResourcePool, number>();
  private readonly controllers = new Map<string, AbortController>();
  private stopped = false;

  constructor(private readonly db: DatabaseSync, private readonly options: ResourceSchedulerOptions) {
    this.ownerId = options.ownerId ?? randomUUID();
    this.leaseMs = options.leaseMs ?? 30_000;
    this.heartbeatMs = options.heartbeatMs ?? Math.max(1_000, Math.floor(this.leaseMs / 3));
    for (const pool of ["download", "inspection", "extraction", "inference"] as const) { this.queues.set(pool, []); this.active.set(pool, 0); }
  }

  enqueue<T>(jobId: string, pool: ResourcePool, task: SchedulerTask<T>): { readonly id: string; readonly promise: Promise<T> } {
    if (this.stopped) throw new Error("RESOURCE_SCHEDULER_STOPPED");
    const id = randomUUID();
    const promise = new Promise<T>((resolve, reject) => { this.queues.get(pool)!.push({ id, jobId, pool, task, resolve, reject } as QueueItem<unknown>); this.pump(pool); });
    return { id, promise };
  }

  cancel(id: string): boolean {
    const controller = this.controllers.get(id);
    if (controller) { controller.abort(); return true; }
    for (const queue of this.queues.values()) {
      const index = queue.findIndex(item => item.id === id);
      if (index >= 0) { const [item] = queue.splice(index, 1); item!.reject(new Error("RESOURCE_TASK_CANCELLED")); return true; }
    }
    return false;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const controller of this.controllers.values()) controller.abort();
    for (const queue of this.queues.values()) { for (const item of queue.splice(0)) item.reject(new Error("RESOURCE_SCHEDULER_STOPPED")); }
    await Promise.resolve();
  }

  recoverExpiredLeases(now = new Date().toISOString()): number {
    const result = this.db.prepare("DELETE FROM resource_leases WHERE expires_at <= ?").run(now);
    return Number(result.changes);
  }

  private pump(pool: ResourcePool): void {
    const queue = this.queues.get(pool)!;
    const limit = this.options.concurrency[pool];
    while (!this.stopped && (this.active.get(pool) ?? 0) < limit && queue.length > 0) {
      const item = queue.shift()!;
      if (!this.acquireLease(item.jobId, pool)) { item.reject(new Error("RESOURCE_LEASE_BUSY")); continue; }
      this.active.set(pool, (this.active.get(pool) ?? 0) + 1);
      const controller = new AbortController(); this.controllers.set(item.id, controller);
      void this.execute(item, controller, pool);
    }
  }

  private async execute<T>(item: QueueItem<T>, controller: AbortController, pool: ResourcePool): Promise<void> {
    const heartbeat = setInterval(() => this.heartbeat(item.jobId, pool), this.heartbeatMs);
    try { item.resolve(await item.task(controller.signal)); }
    catch (error) { item.reject(error); }
    finally { clearInterval(heartbeat); this.releaseLease(item.jobId); this.controllers.delete(item.id); this.active.set(pool, (this.active.get(pool) ?? 1) - 1); this.pump(pool); }
  }

  private acquireLease(jobId: string, pool: ResourcePool): boolean {
    const now = Date.now(); const acquiredAt = new Date(now).toISOString(); const expiresAt = new Date(now + this.leaseMs).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM resource_leases WHERE expires_at <= ?").run(acquiredAt);
      const existing = this.db.prepare("SELECT job_id FROM resource_leases WHERE job_id = ?").get(jobId);
      if (existing) { this.db.exec("ROLLBACK"); return false; }
      this.db.prepare("INSERT INTO resource_leases (job_id, pool, owner_id, acquired_at, expires_at, heartbeat_at) VALUES (?, ?, ?, ?, ?, ?)").run(jobId, pool, this.ownerId, acquiredAt, expiresAt, acquiredAt);
      this.db.exec("COMMIT"); return true;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private heartbeat(jobId: string, pool: ResourcePool): void { const now = Date.now(); this.db.prepare("UPDATE resource_leases SET heartbeat_at = ?, expires_at = ? WHERE job_id = ? AND pool = ? AND owner_id = ?").run(new Date(now).toISOString(), new Date(now + this.leaseMs).toISOString(), jobId, pool, this.ownerId); }
  private releaseLease(jobId: string): void { this.db.prepare("DELETE FROM resource_leases WHERE job_id = ? AND owner_id = ?").run(jobId, this.ownerId); }
}

interface QueueItem<T> { readonly id: string; readonly jobId: string; readonly pool: ResourcePool; readonly task: SchedulerTask<T>; readonly resolve: (value: T) => void; readonly reject: (error: unknown) => void; }

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { migrateResourceDatabase } from "../../src/resource/database-schema.js";
import { ResourceScheduler } from "../../src/resource/scheduler.js";

function database(): DatabaseSync { const db = new DatabaseSync(":memory:"); migrateResourceDatabase(db); return db; }
function addJob(db: DatabaseSync, id: string): void { db.prepare("INSERT INTO resource_jobs (id, version, revision, source, status, stage, destination_root_id, input_json, progress_json, created_at, updated_at) VALUES (?, 1, 1, 'baidu', 'queued', 'created', 'library', '{}', '{}', 'now', 'now')").run(id); }
function wait(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }

describe("Resource scheduler", () => {
  it("runs two download jobs concurrently while a third waits", async () => {
    const db = database(); addJob(db, "job-1"); addJob(db, "job-2"); addJob(db, "job-3"); const scheduler = new ResourceScheduler(db, { concurrency: { download: 2, inspection: 1, extraction: 1, inference: 1 }, leaseMs: 1_000 }); let running = 0; let peak = 0;
    const task = async () => { running += 1; peak = Math.max(peak, running); await wait(40); running -= 1; return "ok"; };
    const first = scheduler.enqueue("job-1", "download", task); const second = scheduler.enqueue("job-2", "download", task); const third = scheduler.enqueue("job-3", "download", task);
    await expect(Promise.all([first.promise, second.promise, third.promise])).resolves.toEqual(["ok", "ok", "ok"]); expect(peak).toBe(2); expect((db.prepare("SELECT COUNT(*) AS count FROM resource_leases").get() as { count: number }).count).toBe(0); await scheduler.stop(); db.close();
  });

  it("keeps pools independent and cancels only the selected task", async () => {
    const db = database(); addJob(db, "download"); addJob(db, "inspection"); const scheduler = new ResourceScheduler(db, { concurrency: { download: 1, inspection: 1, extraction: 1, inference: 1 }, leaseMs: 1_000 }); let inspectionStarted = false;
    const download = scheduler.enqueue("download", "download", async signal => { await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, 80); signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); }, { once: true }); }); return "downloaded"; });
    const inspection = scheduler.enqueue("inspection", "inspection", async () => { inspectionStarted = true; return "inspected"; });
    expect(await inspection.promise).toBe("inspected"); expect(inspectionStarted).toBe(true); expect(scheduler.cancel(download.id)).toBe(true); await expect(download.promise).rejects.toThrow("aborted"); await scheduler.stop(); db.close();
  });

  it("recovers expired leases", () => { const db = database(); addJob(db, "job"); db.prepare("INSERT INTO resource_leases VALUES (?, ?, ?, ?, ?, ?)").run("job", "download", "dead-owner", "2020-01-01", "2020-01-02", "2020-01-01"); const scheduler = new ResourceScheduler(db, { concurrency: { download: 2, inspection: 1, extraction: 1, inference: 1 } }); expect(scheduler.recoverExpiredLeases("2020-01-03")).toBe(1); db.close(); });
});

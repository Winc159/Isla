import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { migrateResourceDatabase, RESOURCE_DATABASE_VERSION } from "../../src/resource/database-schema.js";

describe("Resource SQLite schema", () => {
  it("creates the frozen v1 tables and is idempotent", () => {
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
    migrateResourceDatabase(db);
    migrateResourceDatabase(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>;
    expect(tables.map(row => row.name)).toEqual(expect.arrayContaining(["resource_jobs", "resource_artifacts", "resource_events", "resource_file_ledger", "resource_folder_watches", "resource_job_secrets", "resource_archive_passwords", "resource_leases", "resource_idempotency"]));
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(RESOURCE_DATABASE_VERSION);
    db.close();
  });

  it("enforces revision, event sequence, source and lease pool constraints", () => {
    const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
    migrateResourceDatabase(db);
    const insertJob = db.prepare("INSERT INTO resource_jobs VALUES (?, 1, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, ?, ?)");
    expect(() => insertJob.run("bad", 0, "baidu", "queued", "created", "library", "{}", "{}", "now", "now")).toThrow();
    insertJob.run("job-1", 1, "baidu", "queued", "created", "library", "{}", "{}", "now", "now");
    db.prepare("INSERT INTO resource_events VALUES (?, ?, ?, ?, ?, ?)").run("event-1", "job-1", 1, "job.created", "{}", "now");
    expect(() => db.prepare("INSERT INTO resource_events VALUES (?, ?, ?, ?, ?, ?)").run("event-2", "job-1", 1, "job.progress", "{}", "now")).toThrow();
    expect(() => db.prepare("INSERT INTO resource_leases VALUES (?, ?, ?, ?, ?, ?)").run("job-1", "unknown", "owner", "now", "later", "now")).toThrow();
    db.close();
  });

  it("rejects databases created by a newer Resource version", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`PRAGMA user_version = ${RESOURCE_DATABASE_VERSION + 1}`);
    expect(() => migrateResourceDatabase(db)).toThrow("newer than supported");
    db.close();
  });
});

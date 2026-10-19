import type { DatabaseSync } from "node:sqlite";

export const RESOURCE_DATABASE_VERSION = 3;

export function migrateResourceDatabase(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE;");
  try {
    const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
    if (row.user_version > RESOURCE_DATABASE_VERSION) throw new Error(`Resource database version ${row.user_version} is newer than supported version ${RESOURCE_DATABASE_VERSION}`);
    if (row.user_version < 1) migrateToVersion1(db);
    if (row.user_version < 2) migrateToVersion2(db);
    if (row.user_version < 3) migrateToVersion3(db);
    db.exec(`PRAGMA user_version = ${RESOURCE_DATABASE_VERSION}; COMMIT;`);
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

function migrateToVersion3(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE resource_job_secrets (
      job_id TEXT NOT NULL REFERENCES resource_jobs(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('archive-password', 'share-code')),
      secret_value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(job_id, kind, secret_value)
    );
    CREATE TABLE resource_archive_passwords (
      password TEXT PRIMARY KEY,
      success_count INTEGER NOT NULL CHECK(success_count >= 1),
      first_succeeded_at TEXT NOT NULL,
      last_succeeded_at TEXT NOT NULL
    );
  `);
}

function migrateToVersion2(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE resource_folder_watches (
      id TEXT PRIMARY KEY,
      managed_root_id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      destination_root_id TEXT NOT NULL,
      enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
      created_at TEXT NOT NULL,
      last_scanned_at TEXT,
      UNIQUE(managed_root_id, relative_path, destination_root_id)
    );
  `);
}

function migrateToVersion1(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE resource_jobs (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL CHECK(version = 1),
      revision INTEGER NOT NULL CHECK(revision >= 1),
      source TEXT NOT NULL CHECK(source IN ('baidu', 'managed-folder')),
      status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'waiting_user', 'cancelling', 'completed', 'failed', 'cancelled')),
      stage TEXT NOT NULL,
      destination_root_id TEXT NOT NULL,
      input_json TEXT NOT NULL,
      parse_result_json TEXT,
      model_snapshot_json TEXT,
      progress_json TEXT NOT NULL,
      pending_decision_json TEXT,
      failure_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX resource_jobs_queue_idx ON resource_jobs(status, stage, updated_at);

    CREATE TABLE resource_artifacts (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES resource_jobs(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      size_bytes INTEGER,
      checksum TEXT,
      verification_status TEXT NOT NULL,
      source_artifact_id TEXT REFERENCES resource_artifacts(id),
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(job_id, relative_path)
    );

    CREATE TABLE resource_events (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES resource_jobs(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL CHECK(sequence >= 1),
      type TEXT NOT NULL,
      data_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      UNIQUE(job_id, sequence)
    );
    CREATE INDEX resource_events_stream_idx ON resource_events(job_id, sequence);

    CREATE TABLE resource_file_ledger (
      managed_root_id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      modified_at_ms INTEGER NOT NULL,
      fingerprint TEXT,
      state TEXT NOT NULL CHECK(state IN ('discovered', 'settling', 'queued', 'completed', 'ignored', 'failed')),
      stable_observations INTEGER NOT NULL DEFAULT 0,
      discovered_at TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      job_id TEXT REFERENCES resource_jobs(id),
      PRIMARY KEY(managed_root_id, relative_path)
    );

    CREATE TABLE resource_leases (
      job_id TEXT PRIMARY KEY REFERENCES resource_jobs(id) ON DELETE CASCADE,
      pool TEXT NOT NULL CHECK(pool IN ('download', 'inspection', 'extraction', 'inference')),
      owner_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL
    );
    CREATE INDEX resource_leases_pool_idx ON resource_leases(pool, expires_at);

    CREATE TABLE resource_idempotency (
      scope TEXT NOT NULL,
      key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(scope, key)
    );
  `);
}

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { CoreMemoryBlock, CoreMemoryBlockName, CreateMemoryInput, MemoryRecord, MemoryRevision, MemorySourceInput, SearchDocument, UpdateMemoryInput } from "./types.js";
import { encodeEmbedding } from "./embeddings.js";

export { type CoreMemoryBlock, type CoreMemoryBlockName, type CreateMemoryInput, type MemoryKind, type MemoryProvenance, type MemoryRecord, type MemoryRevision, type MemoryScope, type MemorySourceInput, type MemoryStatus, type UpdateMemoryInput } from "./types.js";

export class MemoryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryConflictError";
  }
}

export class MemoryStore {
  readonly path: string;
  private readonly db: DatabaseSync;

  constructor(path = join(homedir(), ".isla", "memory.sqlite")) {
    this.path = path;
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new DatabaseSync(path, {
      enableForeignKeyConstraints: true,
      timeout: 5_000,
      allowExtension: false,
      defensive: true,
    });
    try {
      this.db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
      this.migrate();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  close(): void { this.db.close(); }

  supportsFts5(): boolean {
    try { this.db.exec("CREATE VIRTUAL TABLE temp.isla_fts_probe USING fts5(content); DROP TABLE temp.isla_fts_probe"); return true; }
    catch { return false; }
  }

  createEmbeddingGeneration(provider: string, model: string, dimensions: number): string {
    if (!Number.isInteger(dimensions) || dimensions <= 0) throw new Error("Embedding dimensions must be positive");
    const id = randomUUID(); this.db.prepare("INSERT INTO embedding_generations VALUES (?, ?, ?, ?, ?)").run(id, provider, model, dimensions, new Date().toISOString()); return id;
  }

  saveEmbedding(targetId: string, generationId: string, vector: readonly number[], dimensions: number): void {
    const generation = this.db.prepare("SELECT dimensions FROM embedding_generations WHERE id = ?").get(generationId) as { dimensions?: number } | undefined;
    if (!generation) throw new Error(`Embedding generation not found: ${generationId}`);
    const blob = encodeEmbedding(vector, generation.dimensions ?? dimensions);
    this.db.prepare("INSERT OR REPLACE INTO embeddings (target_id, generation_id, vector) VALUES (?, ?, ?)").run(targetId, generationId, blob);
  }

  listEmbeddings(generationId: string): Array<{ readonly targetId: string; readonly vector: Buffer }> {
    const rows = this.db.prepare("SELECT target_id, vector FROM embeddings WHERE generation_id = ?").all(generationId) as unknown as Array<{ target_id: string; vector: Buffer }>;
    return rows.map(row => ({ targetId: row.target_id, vector: row.vector }));
  }

  create(input: CreateMemoryInput): MemoryRecord {
    const now = new Date().toISOString();
    const record: MemoryRecord = {
      id: input.id ?? randomUUID(), scope: input.scope, ...(input.workspace ? { workspace: input.workspace } : {}),
      kind: input.kind, content: input.content, status: input.status ?? "active", provenance: input.provenance,
      createdAt: now, updatedAt: now, revision: 1, ...(input.source ? { source: input.source } : {}),
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.insertRecord(record);
      this.upsertSearchDocument(toMemorySearchDocument(record));
      this.insertRevision(record, undefined, "created");
      this.db.exec("COMMIT");
      return record;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  get(id: string): MemoryRecord | undefined { return this.readRecord(id); }

  upsertSearchDocument(document: SearchDocument): void {
    this.db.prepare(`INSERT INTO search_documents (target_id, target_type, scope, workspace, status, content, normalized_content, source_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(target_id) DO UPDATE SET target_type=excluded.target_type, scope=excluded.scope, workspace=excluded.workspace, status=excluded.status, content=excluded.content, normalized_content=excluded.normalized_content, source_json=excluded.source_json, updated_at=excluded.updated_at`)
      .run(document.targetId, document.targetType, document.scope, document.workspace ?? null, document.status, document.content, document.normalizedContent, document.source ? JSON.stringify(document.source) : null, document.updatedAt);
  }

  listSearchDocuments(): SearchDocument[] {
    const rows = this.db.prepare("SELECT * FROM search_documents").all() as unknown as SearchRow[];
    return rows.map(row => ({ targetType: row.target_type as SearchDocument["targetType"], targetId: row.target_id, scope: row.scope as SearchDocument["scope"], ...(row.workspace ? { workspace: row.workspace } : {}), status: row.status as SearchDocument["status"], content: row.content, normalizedContent: row.normalized_content, ...(row.source_json ? { source: JSON.parse(row.source_json) as MemorySourceInput } : {}), updatedAt: row.updated_at }));
  }

  getBlock(name: CoreMemoryBlockName): CoreMemoryBlock | undefined {
    const row = this.db.prepare("SELECT * FROM memory_blocks WHERE name = ?").get(name) as { name: CoreMemoryBlockName; content: string; budget: number; updated_at: string } | undefined;
    return row ? { name: row.name, content: row.content, budget: row.budget, updatedAt: row.updated_at } : undefined;
  }

  saveBlock(name: CoreMemoryBlockName, content: string, budget: number): CoreMemoryBlock {
    if (!Number.isInteger(budget) || budget <= 0) throw new Error("Core Memory budget must be a positive integer");
    if (content.length > budget) throw new Error(`Core Memory block ${name} exceeds its budget`);
    const updatedAt = new Date().toISOString();
    this.db.prepare("INSERT INTO memory_blocks (id, name, content, budget, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET content=excluded.content, budget=excluded.budget, updated_at=excluded.updated_at").run(randomUUID(), name, content, budget, updatedAt);
    return { name, content, budget, updatedAt };
  }

  list(options: { readonly scope?: string; readonly workspace?: string; readonly status?: string; readonly kind?: string } = {}): MemoryRecord[] {
    const clauses: string[] = []; const values: SQLInputValue[] = [];
    for (const [column, value] of [["scope", options.scope], ["workspace", options.workspace], ["status", options.status], ["kind", options.kind]] as const) {
      if (value !== undefined) { clauses.push(`${column} = ?`); values.push(value); }
    }
    const rows = this.db.prepare(`SELECT * FROM memory_records ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY updated_at DESC`).all(...values) as unknown as Row[];
    return rows.map(row => this.toRecord(row));
  }

  update(id: string, input: UpdateMemoryInput): MemoryRecord {
    return this.updateRecord(id, input, undefined);
  }

  private updateRecord(id: string, input: UpdateMemoryInput, forcedAction: MemoryRevision["action"] | undefined): MemoryRecord {
    const before = this.require(id);
    if (before.revision !== input.expectedRevision) throw new MemoryConflictError(`Memory ${id} has revision ${before.revision}, expected ${input.expectedRevision}`);
    const after: MemoryRecord = { ...before, ...(input.content !== undefined ? { content: input.content } : {}), ...(input.status !== undefined ? { status: input.status } : {}), ...(input.provenance !== undefined ? { provenance: input.provenance } : {}), ...(input.source !== undefined ? { source: input.source } : {}), updatedAt: new Date().toISOString(), revision: before.revision + 1 };
    const action = forcedAction ?? (after.status === "disabled" ? "disabled" : "updated");
    this.db.exec("BEGIN IMMEDIATE");
    try { this.replaceRecord(after, before.revision); this.upsertSearchDocument(toMemorySearchDocument(after)); this.insertRevision(after, before, action); this.db.exec("COMMIT"); return after; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  disable(id: string, expectedRevision: number): MemoryRecord { return this.update(id, { expectedRevision, status: "disabled" }); }

  restoreRevision(id: string, revision: number, expectedRevision: number): MemoryRecord {
    const target = this.db.prepare("SELECT after_json FROM memory_revisions WHERE memory_id = ? AND revision = ?").get(id, revision) as { after_json?: string } | undefined;
    if (!target?.after_json) throw new Error(`Memory revision not found: ${id}@${revision}`);
    const restored = JSON.parse(target.after_json) as MemoryRecord;
    return this.updateRecord(id, { expectedRevision, content: restored.content, status: restored.status, provenance: restored.provenance, ...(restored.source ? { source: restored.source } : {}) }, "restored");
  }

  revisions(id: string): MemoryRevision[] {
    const rows = this.db.prepare("SELECT * FROM memory_revisions WHERE memory_id = ? ORDER BY revision ASC").all(id) as unknown as RevisionRow[];
    return rows.map(row => ({ id: row.id, memoryId: row.memory_id, revision: row.revision, action: row.action as MemoryRevision["action"], ...(row.before_json ? { before: JSON.parse(row.before_json) as MemoryRecord } : {}), after: JSON.parse(row.after_json) as MemoryRecord, createdAt: row.created_at }));
  }

  private migrate(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS memory_blocks (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, content TEXT NOT NULL, budget INTEGER NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memory_records (id TEXT PRIMARY KEY, scope TEXT NOT NULL, workspace TEXT, kind TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL, provenance TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS memory_sources (memory_id TEXT PRIMARY KEY REFERENCES memory_records(id) ON DELETE CASCADE, source_type TEXT NOT NULL, session_id TEXT, message_index INTEGER, locator TEXT);
      CREATE TABLE IF NOT EXISTS memory_revisions (id TEXT PRIMARY KEY, memory_id TEXT NOT NULL REFERENCES memory_records(id) ON DELETE CASCADE, revision INTEGER NOT NULL, action TEXT NOT NULL, before_json TEXT, after_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(memory_id, revision));
      CREATE TABLE IF NOT EXISTS embedding_generations (id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS embeddings (target_id TEXT NOT NULL, generation_id TEXT NOT NULL REFERENCES embedding_generations(id) ON DELETE CASCADE, vector BLOB NOT NULL, PRIMARY KEY(target_id, generation_id));
      CREATE TABLE IF NOT EXISTS search_documents (target_id TEXT PRIMARY KEY, target_type TEXT NOT NULL, scope TEXT NOT NULL, workspace TEXT, status TEXT NOT NULL, content TEXT NOT NULL, normalized_content TEXT NOT NULL, source_json TEXT, updated_at TEXT NOT NULL);`);
    try { this.db.exec("ALTER TABLE memory_blocks ADD COLUMN budget INTEGER NOT NULL DEFAULT 2000"); } catch { /* already migrated */ }
    for (const statement of ["ALTER TABLE search_documents ADD COLUMN target_type TEXT NOT NULL DEFAULT 'memory'", "ALTER TABLE search_documents ADD COLUMN scope TEXT NOT NULL DEFAULT 'global'", "ALTER TABLE search_documents ADD COLUMN workspace TEXT", "ALTER TABLE search_documents ADD COLUMN status TEXT NOT NULL DEFAULT 'active'", "ALTER TABLE search_documents ADD COLUMN normalized_content TEXT NOT NULL DEFAULT ''", "ALTER TABLE search_documents ADD COLUMN source_json TEXT", "ALTER TABLE search_documents ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''"]) {
      try { this.db.exec(statement); } catch { /* already migrated */ }
    }
  }

  private insertRecord(record: MemoryRecord): void { this.db.prepare("INSERT INTO memory_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(record.id, record.scope, record.workspace ?? null, record.kind, record.content, record.status, record.provenance, record.createdAt, record.updatedAt, record.revision); if (record.source) this.insertSource(record.id, record.source); }
  private replaceRecord(record: MemoryRecord, expected: number): void { const result = this.db.prepare("UPDATE memory_records SET content=?, status=?, provenance=?, updated_at=?, revision=? WHERE id=? AND revision=?").run(record.content, record.status, record.provenance, record.updatedAt, record.revision, record.id, expected); if (Number(result.changes) !== 1) throw new MemoryConflictError(`Memory ${record.id} was updated by another process`); this.db.prepare("DELETE FROM memory_sources WHERE memory_id = ?").run(record.id); if (record.source) this.insertSource(record.id, record.source); }
  private insertSource(id: string, source: MemorySourceInput): void { this.db.prepare("INSERT INTO memory_sources VALUES (?, ?, ?, ?, ?)").run(id, source.type, source.sessionId ?? null, source.messageIndex ?? null, source.locator ?? null); }
  private insertRevision(after: MemoryRecord, before: MemoryRecord | undefined, action: MemoryRevision["action"]): void { this.db.prepare("INSERT INTO memory_revisions VALUES (?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), after.id, after.revision, action, before ? JSON.stringify(before) : null, JSON.stringify(after), after.updatedAt); }
  private readRecord(id: string): MemoryRecord | undefined { const row = this.db.prepare("SELECT * FROM memory_records WHERE id = ?").get(id) as Row | undefined; return row ? this.toRecord(row) : undefined; }
  private require(id: string): MemoryRecord { const record = this.readRecord(id); if (!record) throw new Error(`Memory not found: ${id}`); return record; }
  private toRecord(row: Row): MemoryRecord { const source = this.db.prepare("SELECT * FROM memory_sources WHERE memory_id = ?").get(row.id) as SourceRow | undefined; return { id: row.id, scope: row.scope as MemoryRecord["scope"], ...(row.workspace ? { workspace: row.workspace } : {}), kind: row.kind as MemoryRecord["kind"], content: row.content, status: row.status as MemoryRecord["status"], provenance: row.provenance as MemoryRecord["provenance"], createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision, ...(source ? { source: { type: source.source_type as MemorySourceInput["type"], ...(source.session_id ? { sessionId: source.session_id } : {}), ...(source.message_index === null ? {} : { messageIndex: source.message_index }), ...(source.locator ? { locator: source.locator } : {}) } } : {}) }; }
}

interface Row { id: string; scope: string; workspace: string | null; kind: string; content: string; status: string; provenance: string; created_at: string; updated_at: string; revision: number; }
interface SourceRow { source_type: string; session_id: string | null; message_index: number | null; locator: string | null; }
interface RevisionRow { id: string; memory_id: string; revision: number; action: string; before_json: string | null; after_json: string; created_at: string; }
interface SearchRow { target_id: string; target_type: string; scope: string; workspace: string | null; status: string; content: string; normalized_content: string; source_json: string | null; updated_at: string; }

function normalizeSearchText(value: string): string { return value.normalize("NFKC").toLocaleLowerCase().replaceAll(/\s+/g, " ").trim(); }
function toMemorySearchDocument(record: MemoryRecord): SearchDocument { return { targetType: "memory", targetId: record.id, scope: record.scope, ...(record.workspace ? { workspace: record.workspace } : {}), status: record.status, content: record.content, normalizedContent: normalizeSearchText(record.content), ...(record.source ? { source: record.source } : {}), updatedAt: record.updatedAt }; }

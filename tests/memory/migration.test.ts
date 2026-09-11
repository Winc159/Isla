import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryRuntime } from "../../src/memory/runtime.js";
import { MemoryStore } from "../../src/memory/store.js";

describe("Memory SQLite migration", () => {
  it("upgrades the previous schema without losing records", () => {
    const directory = mkdtempSync(join(tmpdir(), "isla-migration-")); const path = join(directory, "memory.sqlite");
    const db = new DatabaseSync(path); db.exec("CREATE TABLE memory_blocks (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, content TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE memory_records (id TEXT PRIMARY KEY, scope TEXT NOT NULL, workspace TEXT, kind TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL, provenance TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL); CREATE TABLE memory_sources (memory_id TEXT PRIMARY KEY, source_type TEXT NOT NULL, session_id TEXT, message_index INTEGER, locator TEXT); CREATE TABLE memory_revisions (id TEXT PRIMARY KEY, memory_id TEXT NOT NULL, revision INTEGER NOT NULL, action TEXT NOT NULL, before_json TEXT, after_json TEXT NOT NULL, created_at TEXT NOT NULL); CREATE TABLE search_documents (target_id TEXT PRIMARY KEY, content TEXT NOT NULL); INSERT INTO memory_blocks VALUES ('b1', 'persona', 'legacy persona', 'now');"); db.close();
    const store = new MemoryStore(path); expect(store.getBlock("persona")?.content).toBe("legacy persona"); expect(store.getBlock("persona")?.budget).toBe(2000); const created = store.create({ scope: "global", kind: "fact", content: "after migration", provenance: "explicit-user" }); expect(store.get(created.id)?.content).toBe("after migration"); store.close(); rmSync(directory, { recursive: true, force: true });
  });
  it("disables memory cleanly when the database is corrupt", () => {
    const directory = mkdtempSync(join(tmpdir(), "isla-corrupt-")); const path = join(directory, "memory.sqlite"); writeFileSync(path, "not sqlite", "utf8"); const warnings: string[] = []; const runtime = MemoryRuntime.open({ path, onWarning: warning => warnings.push(warning) }); expect(runtime.enabled).toBe(false); expect(warnings).toHaveLength(1); runtime.close(); rmSync(directory, { recursive: true, force: true });
  });
});

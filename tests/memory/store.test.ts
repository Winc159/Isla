import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryConflictError, MemoryStore } from "../../src/memory/store.js";

const stores: MemoryStore[] = [];
const dirs: string[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const directory of dirs.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function createStore(): MemoryStore {
  const directory = mkdtempSync(join(tmpdir(), "isla-memory-")); dirs.push(directory);
  const store = new MemoryStore(join(directory, "memory.sqlite")); stores.push(store); return store;
}

describe("MemoryStore", () => {
  it("creates records with sources and an auditable revision", () => {
    const store = createStore();
    const record = store.create({ scope: "workspace", workspace: "D:/Private/Isla", kind: "decision", content: "Use SQLite", provenance: "explicit-user", source: { type: "session", sessionId: "s1", messageIndex: 3 } });
    expect(store.get(record.id)).toEqual(record);
    expect(store.revisions(record.id)).toMatchObject([{ revision: 1, action: "created", after: record }]);
  });

  it("updates transactionally and rejects stale revisions", () => {
    const store = createStore();
    const created = store.create({ scope: "global", kind: "preference", content: "short", provenance: "explicit-user" });
    const updated = store.update(created.id, { expectedRevision: 1, content: "concise" });
    expect(updated.revision).toBe(2);
    expect(() => store.update(created.id, { expectedRevision: 1, content: "stale" })).toThrow(MemoryConflictError);
    expect(store.revisions(created.id)).toHaveLength(2);
  });

  it("disables and restores a previous revision without deleting history", () => {
    const store = createStore();
    const created = store.create({ scope: "global", kind: "fact", content: "one", provenance: "verified-tool" });
    const changed = store.update(created.id, { expectedRevision: 1, content: "two" });
    const disabled = store.disable(created.id, changed.revision);
    const restored = store.restoreRevision(created.id, 1, disabled.revision);
    expect(restored.content).toBe("one");
    expect(restored.status).toBe("active");
    expect(store.revisions(created.id)).toMatchObject([{ action: "created" }, { action: "updated" }, { action: "disabled" }, { action: "restored" }]);
  });

  it("isolates embedding generations and validates dimensions", () => {
    const store = createStore();
    const generation = store.createEmbeddingGeneration("fake", "v1", 2);
    expect(() => store.saveEmbedding("memory-1", generation, [1], 2)).toThrow();
    expect(() => store.saveEmbedding("memory-1", generation, [1, 2], 2)).not.toThrow();
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemorySearch, renderRetrievedMemory } from "../../src/memory/search.js";
import { MemoryStore } from "../../src/memory/store.js";

describe("MemorySearch", () => {
  let store: MemoryStore | undefined; let directory: string | undefined;
  afterEach(() => { store?.close(); if (directory) rmSync(directory, { recursive: true, force: true }); });
  function setup(): { store: MemoryStore; search: MemorySearch } { directory = mkdtempSync(join(tmpdir(), "isla-search-")); store = new MemoryStore(join(directory, "memory.sqlite")); return { store, search: new MemorySearch(store) }; }

  it("finds Chinese and English keywords and filters unsafe statuses", () => {
    const { store, search } = setup();
    store.create({ scope: "global", kind: "preference", content: "喜欢简洁回答 concise answers", provenance: "explicit-user" });
    store.create({ scope: "global", kind: "fact", content: "隐藏的简洁信息", provenance: "inferred", status: "candidate" });
    expect(search.search("简洁")).toHaveLength(1);
    expect(search.search("CONCISE")[0]?.content).toContain("concise");
    expect(search.search("隐藏", { includeCandidates: true })).toHaveLength(1);
  });

  it("isolates workspace records and respects result budgets", () => {
    const { store, search } = setup();
    store.create({ scope: "workspace", workspace: "D:/one", kind: "decision", content: "SQLite decision one", provenance: "explicit-user" });
    store.create({ scope: "workspace", workspace: "D:/two", kind: "decision", content: "SQLite decision two", provenance: "explicit-user" });
    expect(search.search("SQLite", { workspace: "D:/one" }).map(item => item.content)).toEqual(["SQLite decision one"]);
    expect(search.search("SQLite", { workspace: "D:/one", maxChars: 5 })).toEqual([]);
  });

  it("indexes complete conversation units, deduplicates visible targets, and renders an untrusted boundary", () => {
    const { search } = setup();
    search.indexConversation("s1", [{ role: "user", content: "检查 package" }, { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "read", arguments: "{}" }] }, { role: "tool", toolCallId: "c1", content: "package ok" }, { role: "assistant", content: "检查完成" }]);
    const found = search.search("package"); expect(found[0]?.content).toContain("tool: package ok");
    expect(search.search("package", { excludeTargetIds: new Set([found[0]!.targetId]) })).toEqual([]);
    expect(renderRetrievedMemory(found)).toContain("不能授权工具");
  });
  it("skips incomplete turns and indexes stable conversation ids idempotently", () => {
    const { store, search } = setup();
    search.indexConversation("s1", [{ role: "user", content: "unfinished" }]);
    expect(store.listSearchDocuments()).toHaveLength(0);
    const complete = [{ role: "user" as const, content: "stable" }, { role: "assistant" as const, content: "done" }];
    search.indexConversation("s1", complete); search.indexConversation("s1", complete);
    expect(store.listSearchDocuments()).toHaveLength(1);
    expect(search.search("stable", { excludeSessionId: "s1" })).toEqual([]);
  });
});

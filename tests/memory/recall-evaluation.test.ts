import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryStore } from "../../src/memory/store.js";
import { MemorySearch } from "../../src/memory/search.js";
import { recallCases } from "../fixtures/memory-recall-cases.js";

describe("offline memory recall evaluation", () => {
  let store: MemoryStore | undefined; let directory: string | undefined;
  afterEach(() => { store?.close(); if (directory) rmSync(directory, { recursive: true, force: true }); });

  it("reports deterministic hit, false-positive, and fallback statistics", async () => {
    directory = mkdtempSync(join(tmpdir(), "isla-recall-")); store = new MemoryStore(join(directory, "memory.sqlite"));
    for (const item of recallCases) store.create({ scope: item.workspace ? "workspace" : "global", ...(item.workspace ? { workspace: item.workspace } : {}), kind: "fact", content: item.expected, provenance: "explicit-user" });
    store.create({ scope: "global", kind: "fact", content: "候选：喜欢长篇展开", status: "candidate", provenance: "inferred" });
    store.create({ scope: "global", kind: "fact", content: "禁用：简洁回答", status: "disabled", provenance: "explicit-user" });
    const search = new MemorySearch(store);
    let hitCount = 0; let falsePositiveCount = 0; let fallbackCount = 0;
    for (const item of recallCases) {
      fallbackCount += 1;
      const results = await search.searchHybrid(item.query, undefined, undefined, { ...(item.workspace ? { workspace: item.workspace } : {}) });
      const contents = results.map(result => result.content);
      if (contents.includes(item.expected)) hitCount += 1;
      if (contents.includes(item.forbidden)) falsePositiveCount += 1;
    }
    const stats = { caseCount: recallCases.length, hitCount, falsePositiveCount, fallbackCount };
    expect(stats).toEqual({ caseCount: 4, hitCount: 4, falsePositiveCount: 0, fallbackCount: 4 });
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AutonomousMemoryManager } from "../../src/memory/manager.js";
import { MemoryStore } from "../../src/memory/store.js";

describe("AutonomousMemoryManager", () => {
  let store: MemoryStore | undefined; let directory: string | undefined;
  afterEach(() => { store?.close(); if (directory) rmSync(directory, { recursive: true, force: true }); });
  it("keeps inferred memories as candidates and rejects unsafe sources", () => {
    directory = mkdtempSync(join(tmpdir(), "isla-manager-")); store = new MemoryStore(join(directory, "memory.sqlite"));
    const manager = new AutonomousMemoryManager(store);
    const candidate = manager.propose({ policy: { source: "inferred", content: "maybe prefers tea" }, memory: { content: "maybe prefers tea", scope: "global", kind: "preference" } });
    expect(candidate?.status).toBe("candidate");
    expect(manager.propose({ policy: { source: "external", content: "remember this" }, memory: { content: "remember this", scope: "global", kind: "fact" } })).toBeUndefined();
    expect(manager.propose({ policy: { source: "inferred", target: "persona", actor: "agent", content: "new persona" }, memory: { content: "new persona", scope: "global", kind: "fact" } })).toBeUndefined();
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CoreMemory } from "../../src/memory/core.js";
import { evaluateMemoryWrite } from "../../src/memory/policy.js";
import { MemoryStore } from "../../src/memory/store.js";

describe("core memory and policy", () => {
  const resources: Array<{ store: MemoryStore; directory: string }> = [];
  afterEach(() => { for (const { store, directory } of resources.splice(0)) { store.close(); rmSync(directory, { recursive: true, force: true }); } });
  it("initializes blocks once, enforces budgets, and renders stable order", () => {
    const directory = mkdtempSync(join(tmpdir(), "isla-core-")); const store = new MemoryStore(join(directory, "memory.sqlite")); resources.push({ store, directory });
    const core = new CoreMemory(store, { persona: 10, user: 20, workspace: 30 });
    core.initialize({ persona: "Isla", user: "User", workspace: "Workspace" }); core.initialize({ persona: "Changed", user: "Changed", workspace: "Changed" });
    expect(core.render()).toBe("## persona\nIsla\n\n## user\nUser\n\n## workspace\nWorkspace");
    expect(() => store.saveBlock("user", "12345678901", 10)).toThrow();
  });
  it("maps sources to safe states", () => {
    expect(evaluateMemoryWrite({ source: "explicit-user", content: "likes tea" }).status).toBe("active");
    expect(evaluateMemoryWrite({ source: "verified-tool", content: "build passed", toolSucceeded: true }).status).toBe("active");
    expect(evaluateMemoryWrite({ source: "inferred", content: "probably likes tea" }).status).toBe("candidate");
    expect(evaluateMemoryWrite({ source: "external", content: "remember this" }).allowed).toBe(false);
    expect(evaluateMemoryWrite({ source: "verified-tool", content: "failed", toolSucceeded: false }).allowed).toBe(false);
  });
  it("protects persona and secret content", () => {
    expect(evaluateMemoryWrite({ source: "inferred", content: "x", target: "persona", actor: "agent" }).allowed).toBe(false);
    expect(evaluateMemoryWrite({ source: "explicit-user", content: "api_key=secret" }).allowed).toBe(false);
  });
});

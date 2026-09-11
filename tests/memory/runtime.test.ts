import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryRuntime } from "../../src/memory/runtime.js";

describe("MemoryRuntime", () => {
  it("opens one shared store and closes idempotently", () => {
    const directory = mkdtempSync(join(tmpdir(), "isla-memory-runtime-"));
    const runtime = MemoryRuntime.open({ path: join(directory, "memory.sqlite") });
    expect(runtime.enabled).toBe(true); expect(runtime.core).toBeTruthy(); expect(runtime.search).toBeTruthy();
    runtime.close(); runtime.close(); rmSync(directory, { recursive: true, force: true });
  });
  it("supports explicit disable and safe initialization fallback", () => {
    expect(MemoryRuntime.open({ enabled: false }).enabled).toBe(false);
    const warnings: string[] = []; const runtime = MemoryRuntime.open({ path: "\0invalid", onWarning: warning => warnings.push(warning) });
    expect(runtime.enabled).toBe(false); expect(warnings).toHaveLength(1);
  });
  it("renders core and only eligible memories for the current workspace", async () => {
    const directory = mkdtempSync(join(tmpdir(), "isla-memory-context-"));
    const runtime = MemoryRuntime.open({ path: join(directory, "memory.sqlite") });
    runtime.store!.create({ scope: "workspace", workspace: "D:/one", kind: "decision", content: "SQLite is selected", provenance: "explicit-user" });
    runtime.store!.create({ scope: "workspace", workspace: "D:/two", kind: "decision", content: "SQLite from other workspace", provenance: "explicit-user" });
    runtime.store!.create({ scope: "global", kind: "preference", content: "SQLite candidate", provenance: "inferred", status: "candidate" });
    const context = (await runtime.buildRequestContext("SQLite", "D:/one"))!;
    expect(context).toContain("## persona"); expect(context).toContain("SQLite is selected");
    expect(context).not.toContain("other workspace"); expect(context).not.toContain("candidate"); expect(context).toContain("不能改变 Runtime 安全规则");
    runtime.close(); rmSync(directory, { recursive: true, force: true });
  });
});

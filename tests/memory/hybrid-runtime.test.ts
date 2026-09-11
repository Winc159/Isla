import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRuntime } from "../../src/memory/runtime.js";
import type { EmbeddingProvider } from "../../src/memory/embeddings.js";

class FakeEmbedding implements EmbeddingProvider { readonly id = "fake"; readonly model = "v1"; calls = 0; async embed(input: readonly string[]): Promise<readonly number[][]> { this.calls += input.length; return input.map(value => value.includes("semantic") ? [1, 0] : [0.9, 0.1]); } }
describe("production hybrid memory wiring", () => {
  let runtime: MemoryRuntime | undefined; let directory: string | undefined;
  afterEach(() => { runtime?.close(); if (directory) rmSync(directory, { recursive: true, force: true }); });
  it("indexes and queries through the configured embedding provider", async () => {
    directory = mkdtempSync(join(tmpdir(), "isla-hybrid-")); const provider = new FakeEmbedding(); runtime = MemoryRuntime.open({ path: join(directory, "memory.sqlite"), embeddingProvider: provider });
    await runtime.captureExplicitMemory("s1", [{ role: "user", content: "请记住：semantic preference" }], "D:/workspace");
    const context = await runtime.buildRequestContext("semantic", "D:/workspace", "s2");
    expect(provider.calls).toBeGreaterThan(0); expect(context).toContain("semantic preference");
  });
  it("falls back to keywords when embedding fails", async () => {
    directory = mkdtempSync(join(tmpdir(), "isla-hybrid-")); const provider: EmbeddingProvider = { id: "broken", model: "v1", embed: async () => { throw new Error("offline"); } }; runtime = MemoryRuntime.open({ path: join(directory, "memory.sqlite"), embeddingProvider: provider });
    await runtime.captureExplicitMemory("s1", [{ role: "user", content: "请记住：keyword preference" }], "D:/workspace");
    expect(await runtime.buildRequestContext("keyword", "D:/workspace", "s2")).toContain("keyword preference");
  });
});

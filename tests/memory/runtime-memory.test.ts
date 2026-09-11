import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryRuntime } from "../../src/memory/runtime.js";

describe("explicit memory capture", () => {
  it("writes one active record with source and ignores unsafe/non-explicit text", () => {
    const directory = mkdtempSync(join(tmpdir(), "isla-explicit-memory-")); const runtime = MemoryRuntime.open({ path: join(directory, "memory.sqlite") });
    const messages = [{ role: "user" as const, content: "请记住：我喜欢简洁回答" }, { role: "assistant" as const, content: "好的" }];
    runtime.captureExplicitMemory("s1", messages, "D:/workspace"); runtime.captureExplicitMemory("s1", messages, "D:/workspace");
    expect(runtime.store!.list()).toMatchObject([{ status: "active", provenance: "explicit-user", content: "我喜欢简洁回答", source: { sessionId: "s1", messageIndex: 0 } }]);
    runtime.captureExplicitMemory("s1", [{ role: "user", content: "普通问题" }, { role: "assistant", content: "回答" }], "D:/workspace");
    runtime.captureExplicitMemory("s1", [{ role: "user", content: "记住 api_key=secret" }, { role: "assistant", content: "不能" }], "D:/workspace");
    expect(runtime.store!.list()).toHaveLength(1); runtime.close(); rmSync(directory, { recursive: true, force: true });
  });
});

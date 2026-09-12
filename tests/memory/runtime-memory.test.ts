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

  it("recalls explicit memory from a different session", async () => {
    const directory = mkdtempSync(join(tmpdir(), "isla-cross-session-memory-"));
    const runtime = MemoryRuntime.open({ path: join(directory, "memory.sqlite") });
    await runtime.captureExplicitMemory("session-one", [{ role: "user", content: "请记住：本次验收偏好是简洁回答" }, { role: "assistant", content: "已记住" }], directory);
    const context = await runtime.buildRequestContext("本次验收记录的偏好是什么？", directory, "session-two");
    expect(context).toContain("本次验收偏好是简洁回答");
    runtime.close(); rmSync(directory, { recursive: true, force: true });
  });

  it("captures explicit memory when the user input ends with punctuation", () => {
    const directory = mkdtempSync(join(tmpdir(), "isla-punctuated-memory-"));
    const runtime = MemoryRuntime.open({ path: join(directory, "memory.sqlite") });
    runtime.captureExplicitMemory("session-punctuation", [{ role: "user", content: "请记住：本次验收偏好是简洁回答。" }, { role: "assistant", content: "已记住" }], directory);
    expect(runtime.store!.list({ status: "active" }).some(record => record.content.includes("简洁回答"))).toBe(true);
    runtime.close(); rmSync(directory, { recursive: true, force: true });
  });
});

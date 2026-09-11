import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryRuntime } from "../../src/memory/runtime.js";

describe("checkpoint candidate extraction", () => {
  it("stores summary-derived facts as candidates and blocks secrets", () => {
    const directory = mkdtempSync(join(tmpdir(), "isla-candidate-")); const runtime = MemoryRuntime.open({ path: join(directory, "memory.sqlite") });
    runtime.captureCheckpointCandidates("s1", { throughMessageIndex: 8, createdAt: "now", provider: "fake", model: "fake", content: "## 已确认决策与约束\n- 用户偏好简洁回答\n- api_key=secret\n## 当前目标\n- 完成工作区约束" }, "D:/workspace");
    const records = runtime.store!.list({ status: "candidate" }); expect(records).toHaveLength(2); expect(records.every(record => record.provenance === "inferred")).toBe(true); expect(records.some(record => record.content.includes("api_key"))).toBe(false);
    runtime.close(); rmSync(directory, { recursive: true, force: true });
  });
});

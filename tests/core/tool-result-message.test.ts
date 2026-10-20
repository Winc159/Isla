import { describe, expect, it } from "vitest";
import { prepareToolResultMessage } from "../../src/core/tool-result-message.js";

describe("tool result message", () => {
  it("projects a successful result into a canonical tool message", () => {
    const prepared = prepareToolResultMessage("call-1", { ok: true, content: "done" });

    expect(prepared.message).toEqual({ role: "tool", toolCallId: "call-1", content: "done" });
    expect(prepared.pruning).toMatchObject({ pruned: false, originalChars: 4, retainedChars: 4 });
  });

  it("projects a failure into the existing safe code and message format", () => {
    const prepared = prepareToolResultMessage("call-2", { ok: false, code: "USER_REJECTED", message: "用户拒绝" });

    expect(prepared.message).toEqual({ role: "tool", toolCallId: "call-2", content: "[USER_REJECTED] 用户拒绝" });
    expect(prepared.pruning.pruned).toBe(false);
  });

  it("bounds oversized tool content and exposes pruning diagnostics", () => {
    const prepared = prepareToolResultMessage("call-3", { ok: true, content: "x".repeat(7_000) });

    expect(prepared.message.content).toContain("TOOL_RESULT_PRUNED");
    expect(prepared.pruning).toMatchObject({ pruned: true, originalChars: 7_000 });
  });
});

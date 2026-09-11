import { describe, expect, it } from "vitest";
import { projectModelMessages, type SessionEvent } from "../../src/core/events.js";

describe("session event projection", () => {
  it("rebuilds model messages without exposing summaries", () => {
    const events: SessionEvent[] = [
      { type: "user", input: "读取 README" },
      { type: "intent", intent: { kind: "inspect", goal: "读取 README", needsHistory: false, needsTools: true, requiresUserConfirmation: false, missingInformation: [] } },
      { type: "tool_call", callId: "c1", tool: "read_text_file", arguments: '{"path":"README.md"}' },
      { type: "tool_result", callId: "c1", tool: "read_text_file", result: { ok: true, content: "内容" } },
      { type: "assistant", text: "已读取" },
      { type: "turn_summary", turn: 1, category: "inspect", evidence: ["read_text_file"], outcome: "completed" },
    ];
    expect(projectModelMessages(events)).toEqual([
      { role: "user", content: "读取 README" },
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "read_text_file", arguments: '{"path":"README.md"}' }] },
      { role: "tool", toolCallId: "c1", content: "内容" },
      { role: "assistant", content: "已读取" },
    ]);
  });

  it("preserves event order across a restored session", () => {
    const events: SessionEvent[] = [
      { type: "user", input: "第一问" },
      { type: "assistant", text: "第一答" },
      { type: "user", input: "第二问" },
      { type: "assistant", text: "第二答" },
    ];
    expect(projectModelMessages(events).map(message => message.content)).toEqual(["第一问", "第一答", "第二问", "第二答"]);
  });
});

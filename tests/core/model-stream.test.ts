import { describe, expect, it } from "vitest";
import { ModelStreamAssembler } from "../../src/core/model-stream.js";

describe("ModelStreamAssembler", () => {
  it("assembles text, usage and a terminal event", () => {
    const assembler = new ModelStreamAssembler();
    assembler.add({ type: "text_delta", index: 0, delta: "你好" });
    assembler.add({ type: "text_delta", index: 0, delta: "，世界" });
    assembler.add({ type: "usage", usage: { input: 2, output: 3, total: 5 } });
    assembler.add({ type: "finish", reason: "stop", model: "fixture" });
    expect(assembler.finish()).toMatchObject({ text: "你好，世界", response: { text: "你好，世界", model: "fixture", usage: { total: 5 } } });
  });

  it("assembles interleaved tool calls by index without parsing partial JSON", () => {
    const assembler = new ModelStreamAssembler();
    assembler.add({ type: "tool_call_delta", index: 1, id: "b", name: "read_text_file", argumentsDelta: '{"path":' });
    assembler.add({ type: "tool_call_delta", index: 0, id: "a", name: "list_directory", argumentsDelta: '{"path":"."}' });
    assembler.add({ type: "tool_call_delta", index: 1, argumentsDelta: '"README.md"}' });
    assembler.add({ type: "finish", reason: "tool_calls" });
    expect(assembler.finish().toolCalls).toEqual([
      { id: "a", name: "list_directory", arguments: '{"path":"."}' },
      { id: "b", name: "read_text_file", arguments: '{"path":"README.md"}' },
    ]);
  });

  it("rejects missing finish, incomplete calls and post-finish events", () => {
    const missingFinish = new ModelStreamAssembler();
    missingFinish.add({ type: "text_delta", index: 0, delta: "x" });
    expect(() => missingFinish.finish()).toThrow("缺少 finish");

    const incomplete = new ModelStreamAssembler();
    incomplete.add({ type: "tool_call_delta", index: 0, id: "a", argumentsDelta: "{}" });
    incomplete.add({ type: "finish", reason: "tool_calls" });
    expect(() => incomplete.finish()).toThrow("未完整组装");

    const afterFinish = new ModelStreamAssembler();
    afterFinish.add({ type: "finish", reason: "stop" });
    expect(() => afterFinish.add({ type: "text_delta", index: 0, delta: "late" })).toThrow("finish 后");
  });

  it("does not convert non-success finishes into a successful response", () => {
    const cancelled = new ModelStreamAssembler();
    expect(() => cancelled.add({ type: "finish", reason: "cancelled" })).toThrow("取消");
  });
});

import { describe, expect, it } from "vitest";
import { mapOpenAIStreamEvent } from "../../src/providers/openai.js";

describe("OpenAI Responses stream adapter", () => {
  it("maps text and function-call argument events", () => {
    expect(mapOpenAIStreamEvent({ type: "response.output_text.delta", content_index: 0, delta: "你好" })).toEqual({ type: "text_delta", index: 0, delta: "你好" });
    expect(mapOpenAIStreamEvent({ type: "response.function_call_arguments.delta", output_index: 1, item_id: "call-1", delta: '{"path":' })).toEqual({ type: "tool_call_delta", index: 1, id: "call-1", argumentsDelta: '{"path":' });
    expect(mapOpenAIStreamEvent({ type: "response.function_call_arguments.done", output_index: 1, item_id: "call-1", name: "read_text_file", arguments: '{"path":"README.md"}' })).toEqual({ type: "tool_call_delta", index: 1, id: "call-1", name: "read_text_file", argumentsDelta: "" });
  });

  it("maps semantic terminal events and ignores non-semantic events", () => {
    expect(mapOpenAIStreamEvent({ type: "response.completed", response: { model: "gpt-test" } })).toEqual({ type: "finish", reason: "stop", model: "gpt-test" });
    expect(mapOpenAIStreamEvent({ type: "response.incomplete", response: { model: "gpt-test" } })).toMatchObject({ type: "finish", reason: "max_tokens", model: "gpt-test" });
    expect(mapOpenAIStreamEvent({ type: "response.created" })).toBeUndefined();
  });
});

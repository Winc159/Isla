import { describe, expect, it } from "vitest";
import { bailianCapabilities } from "../../src/providers/bailian-capabilities.js";

describe("Bailian model capabilities", () => {
  it.each(["qwen-plus", "qwen3.7-plus"])("enables Tool Calling for verified model %s", model => expect(bailianCapabilities(model, false).toolCalling).toBe(true));
  it.each(["qwen3.7-plus-latest", "qwen-max", "deepseek-v4-flash"])("keeps unknown model %s disabled", model => expect(bailianCapabilities(model, false).toolCalling).toBe(false));
  it("keeps streaming Tool Calls disabled", () => expect(bailianCapabilities("qwen3.7-plus", true)).toEqual({ toolCalling: true, nativeStreaming: true, streamingToolCalls: false }));
});

import { describe, expect, it } from "vitest";
import { bailianCapabilities } from "../../src/providers/bailian-capabilities.js";

describe("Bailian model capabilities", () => {
  it.each(["qwen-plus", "qwen3.7-plus", "qwen3.8-27b", "unknown"])("defaults Tool Calling on when catalog data is unavailable for %s", model => expect(bailianCapabilities(model, false).toolCalling).toBe(true));
  it("honors an explicit catalog rejection", () => expect(bailianCapabilities("text-only", false, false).toolCalling).toBe(false));
  it("keeps streaming Tool Calls disabled", () => expect(bailianCapabilities("qwen3.7-plus", true)).toEqual({ toolCalling: true, nativeStreaming: true, streamingToolCalls: false }));
});

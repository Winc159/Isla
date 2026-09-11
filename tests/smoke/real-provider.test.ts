import { describe, expect, it } from "vitest";
import { createDeepSeekPlugin } from "../../src/providers/deepseek.js";
import { IslaRuntime } from "../../src/core/runtime.js";

const enabled = process.env.ISLA_RUN_REAL_SMOKE === "1";
const configured = Boolean(process.env.DEEPSEEK_API_KEY && process.env.ISLA_MODEL);

describe.skipIf(!enabled || !configured)("real DeepSeek smoke", () => {
  it("answers two independent prompts", async () => {
    const runtime = new IslaRuntime().use(createDeepSeekPlugin({
      provider: "deepseek",
      model: process.env.ISLA_MODEL!,
      apiKey: process.env.DEEPSEEK_API_KEY!,
      timeoutMs: 30_000,
      debug: false,
      maxContextTurns: 20,
    }));
    const provider = runtime.createSession({ providerId: "deepseek" });
    const first = await provider.send("Reply with the single word: ready");
    const second = await provider.send("Reply with the single word: second");
    expect(first.text.trim()).toBeTruthy();
    expect(second.text.trim()).toBeTruthy();
  }, 90_000);
});

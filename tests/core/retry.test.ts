import { describe, expect, it } from "vitest";
import { ChatSession } from "../../src/core/session.js";
import { RuntimeError } from "../../src/core/errors.js";
import type { ModelProvider, ModelRequest, ModelResponse } from "../../src/core/types.js";

class RetryProvider implements ModelProvider {
  readonly id = "retry-test";
  readonly model = "retry-model";
  calls = 0;
  constructor(private readonly first: Error) {}
  async generate(_request: ModelRequest): Promise<ModelResponse> {
    this.calls += 1;
    if (this.calls === 1) throw this.first;
    return { text: "重试成功" };
  }
}

describe("model retry policy", () => {
  it("retries one recoverable provider failure", async () => {
    const provider = new RetryProvider(new RuntimeError({ code: "PROVIDER_NETWORK", recoverable: true, message: "网络暂时不可用" }));
    const events: string[] = [];
    await expect(new ChatSession(provider, { modelRetries: 1, onModelStepEvent: event => { if (event.type === "model_step_end") events.push(event.result); } }).send("你好")).resolves.toMatchObject({ text: "重试成功" });
    expect(provider.calls).toBe(2);
    expect(events).toEqual(["retry", "candidate_yield"]);
  });

  it("does not retry a non-recoverable provider failure", async () => {
    const provider = new RetryProvider(new RuntimeError({ code: "PROVIDER_AUTH", recoverable: false, message: "认证失败" }));
    await expect(new ChatSession(provider, { modelRetries: 1 }).send("你好")).rejects.toMatchObject({ code: "PROVIDER_AUTH" });
    expect(provider.calls).toBe(1);
  });

  it("reports a cancelled step exactly once", async () => {
    const provider = new RetryProvider(new RuntimeError({ code: "TURN_CANCELLED", recoverable: false, message: "已取消" }));
    const events: string[] = [];
    await expect(new ChatSession(provider, { onModelStepEvent: event => { if (event.type === "model_step_end") events.push(event.result); } }).send("你好")).rejects.toMatchObject({ code: "TURN_CANCELLED" });
    expect(events).toEqual(["cancelled"]);
  });
});

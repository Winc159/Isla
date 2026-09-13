import { describe, expect, it } from "vitest";
import { RuntimeError, isRuntimeError, normalizeProviderError } from "../../src/core/errors.js";
import { FakeProvider } from "../support/fake-provider.js";

describe("RuntimeError", () => {
  it("preserves a stable safe error record", () => {
    const error = new RuntimeError({ code: "PROVIDER_TIMEOUT", recoverable: true, message: "模型服务请求超时。" });
    expect(isRuntimeError(error)).toBe(true);
    expect(error.toRecord()).toEqual({ code: "PROVIDER_TIMEOUT", recoverable: true, message: "模型服务请求超时。" });
  });

  it("does not expose the original cause through the safe record", () => {
    const error = new RuntimeError({ code: "PROVIDER_AUTH", recoverable: false, message: "模型服务认证失败。" }, { cause: new Error("Authorization: secret") });
    expect(error.toRecord()).not.toHaveProperty("cause");
    expect(error.toRecord().message).not.toContain("secret");
  });

  it("defines cancellation as a stable non-retryable runtime code", () => {
    const error = new RuntimeError({ code: "TURN_CANCELLED", recoverable: false, message: "当前回合已取消。" });
    expect(error.toRecord()).toEqual({ code: "TURN_CANCELLED", recoverable: false, message: "当前回合已取消。" });
  });

  it("normalizes provider AbortError without treating it as a network failure", () => {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    expect(normalizeProviderError(error, "Test").toRecord()).toEqual({ code: "TURN_CANCELLED", recoverable: false, message: "当前回合已取消。" });
  });

  it("projects only a safe HTTP status for unknown provider responses", () => {
    const error = normalizeProviderError(Object.assign(new Error("response body contains secret"), { status: 422 }), "DeepSeek");
    expect(error.code).toBe("PROVIDER_INVALID_RESPONSE");
    expect(error.message).toContain("HTTP 422");
    expect(error.message).not.toContain("secret");
  });

  it("keeps the provider call signal available for the runtime boundary", async () => {
    const provider = new FakeProvider([{ text: "ok" }]);
    const controller = new AbortController();
    await provider.generate({ messages: [] }, { signal: controller.signal });
    expect(provider.signals).toEqual([controller.signal]);
  });
});

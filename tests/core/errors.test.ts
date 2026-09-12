import { describe, expect, it } from "vitest";
import { RuntimeError, isRuntimeError } from "../../src/core/errors.js";

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
});

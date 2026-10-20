import { describe, expect, it } from "vitest";
import { RuntimeError } from "../../src/core/errors.js";
import { mapTurnFailure } from "../../src/core/turn-failure.js";

describe("turn failure mapping", () => {
  it("maps an aborted signal to the stable cancelled terminal state", () => {
    const result = mapTurnFailure(new Error("provider detail"), true);

    expect(result).toMatchObject({
      status: "cancelled",
      record: { code: "TURN_CANCELLED", recoverable: false, message: "当前回合已取消。" },
      errorToThrow: { code: "TURN_CANCELLED", recoverable: false, message: "当前回合已取消。" },
    });
  });

  it("treats an explicit runtime cancellation as cancelled without a signal", () => {
    const result = mapTurnFailure(new RuntimeError({ code: "TURN_CANCELLED", recoverable: false, message: "provider cancelled" }), false);

    expect(result.status).toBe("cancelled");
    expect(result.record?.message).toBe("当前回合已取消。");
  });

  it("keeps a safe runtime failure record and preserves the original error", () => {
    const error = new RuntimeError({ code: "PROVIDER_AUTH", recoverable: false, message: "认证失败" });
    const result = mapTurnFailure(error, false);

    expect(result).toEqual({ status: "failed", record: error.toRecord(), errorToThrow: error });
  });

  it("does not persist an unsafe record for an unknown error", () => {
    const error = new Error("private detail");
    const result = mapTurnFailure(error, false);

    expect(result).toEqual({ status: "failed", record: undefined, errorToThrow: error });
  });
});

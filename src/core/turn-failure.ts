import { isRuntimeError, RuntimeError, type SafeErrorRecord } from "./errors.js";
import type { TurnStatus } from "./journal.js";

const CANCELLED_RECORD: SafeErrorRecord = {
  code: "TURN_CANCELLED",
  recoverable: false,
  message: "当前回合已取消。",
};

export interface TurnFailureMapping {
  readonly status: Extract<TurnStatus, "cancelled" | "failed">;
  readonly record: SafeErrorRecord | undefined;
  readonly errorToThrow: unknown;
}

export function mapTurnFailure(error: unknown, signalAborted: boolean): TurnFailureMapping {
  const cancelled = signalAborted || (isRuntimeError(error) && error.code === "TURN_CANCELLED");
  if (cancelled) {
    return {
      status: "cancelled",
      record: CANCELLED_RECORD,
      errorToThrow: new RuntimeError(CANCELLED_RECORD),
    };
  }
  return {
    status: "failed",
    record: isRuntimeError(error) ? error.toRecord() : undefined,
    errorToThrow: error,
  };
}

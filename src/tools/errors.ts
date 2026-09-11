export type ToolFailureCode = "INVALID_ARGUMENTS" | "SANDBOX_DENIED" | "EXECUTION_FAILED";

export class ToolFailure extends Error {
  constructor(readonly code: ToolFailureCode, message: string) {
    super(message);
    this.name = "ToolFailure";
  }
}

export function invalidArguments(message: string): ToolFailure {
  return new ToolFailure("INVALID_ARGUMENTS", message);
}

export function sandboxDenied(message: string): ToolFailure {
  return new ToolFailure("SANDBOX_DENIED", message);
}

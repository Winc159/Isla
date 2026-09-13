export type ToolFailureCode = "INVALID_ARGUMENTS" | "SANDBOX_DENIED" | "EXECUTION_FAILED" | "TURN_CANCELLED" | "WEB_INVALID_URL" | "WEB_HOST_NOT_ALLOWED" | "WEB_BLOCKED_URL" | "WEB_REDIRECT_BLOCKED" | "WEB_FETCH_TOO_LARGE" | "WEB_UNSUPPORTED_CONTENT_TYPE" | "WEB_FETCH_TIMEOUT" | "WEB_NETWORK_ERROR";

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

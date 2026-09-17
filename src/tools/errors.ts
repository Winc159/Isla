export type ToolFailureCode = "INVALID_ARGUMENTS" | "SANDBOX_DENIED" | "EXECUTION_FAILED" | "COMMAND_EXECUTION_FAILED" | "TURN_CANCELLED" | "FILE_NOT_OBSERVED" | "FILE_STALE" | "EDIT_NO_MATCH" | "EDIT_MULTIPLE_MATCHES" | "PROJECT_DISCOVERY_TIMEOUT" | "PROJECT_DISCOVERY_TOO_LARGE" | "PROJECT_DISCOVERY_FAILED" | "WEB_INVALID_URL" | "WEB_HOST_NOT_ALLOWED" | "WEB_BLOCKED_URL" | "WEB_REDIRECT_BLOCKED" | "WEB_FETCH_TOO_LARGE" | "WEB_UNSUPPORTED_CONTENT_TYPE" | "WEB_FETCH_TIMEOUT" | "WEB_NETWORK_ERROR" | "WEB_SEARCH_INVALID_QUERY" | "WEB_SEARCH_UNAVAILABLE" | "WEB_SEARCH_TIMEOUT" | "WEB_SEARCH_RATE_LIMITED" | "WEB_SEARCH_RESPONSE_INVALID" | "WEB_SEARCH_NETWORK_ERROR";

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

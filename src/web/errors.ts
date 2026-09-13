import type { WebFetchErrorCode } from "./types.js";

export class WebFetchError extends Error {
  constructor(readonly code: WebFetchErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WebFetchError";
  }
}

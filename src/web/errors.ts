import type { WebFetchErrorCode, WebSearchErrorCode } from "./types.js";

export class WebFetchError extends Error {
  constructor(readonly code: WebFetchErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WebFetchError";
  }
}

export class WebSearchError extends Error {
  constructor(readonly code: WebSearchErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WebSearchError";
  }
}

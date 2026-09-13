export type WebFetchBody =
  | { readonly kind: "html"; readonly content: string }
  | { readonly kind: "text"; readonly content: string };

export interface WebFetchRequest { readonly url: string; }

export interface WebFetchResult {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly statusCode: number;
  readonly contentType: string;
  readonly body: WebFetchBody;
  readonly bytesRead: number;
  readonly truncated: boolean;
}

export type WebFetchErrorCode =
  | "WEB_INVALID_URL"
  | "WEB_HOST_NOT_ALLOWED"
  | "WEB_BLOCKED_URL"
  | "WEB_REDIRECT_BLOCKED"
  | "WEB_FETCH_TOO_LARGE"
  | "WEB_UNSUPPORTED_CONTENT_TYPE"
  | "WEB_FETCH_TIMEOUT"
  | "WEB_NETWORK_ERROR"
  | "TURN_CANCELLED";

export interface WebFetchConfigLike {
  readonly allowedHosts: readonly string[];
  readonly maxBodyChars: number;
  readonly maxOutputChars: number;
}

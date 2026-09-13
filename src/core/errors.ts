export type RuntimeErrorCode =
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_NETWORK"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_AUTH"
  | "PROVIDER_EMPTY_RESPONSE"
  | "PROVIDER_INVALID_RESPONSE"
  | "PERSISTENCE_FAILED"
  | "TOOL_FAILED"
  | "USER_REJECTED"
  | "PERMISSION_DENIED"
  | "SANDBOX_DENIED"
  | "INTERRUPTED"
  | "TURN_CANCELLED"
  | "UNKNOWN";

export type TurnCancelReason =
  | { readonly kind: "user" }
  | { readonly kind: "disconnect" }
  | { readonly kind: "shutdown" };

export interface SafeErrorRecord {
  readonly code: RuntimeErrorCode;
  readonly recoverable: boolean;
  readonly message: string;
}

export class RuntimeError extends Error {
  readonly code: RuntimeErrorCode;
  readonly recoverable: boolean;

  constructor(record: SafeErrorRecord, options?: { readonly cause?: unknown }) {
    super(record.message, options);
    this.name = "RuntimeError";
    this.code = record.code;
    this.recoverable = record.recoverable;
  }

  toRecord(): SafeErrorRecord {
    return { code: this.code, recoverable: this.recoverable, message: this.message };
  }
}

export function isRuntimeError(error: unknown): error is RuntimeError {
  return error instanceof RuntimeError;
}

export function normalizeProviderError(error: unknown, provider: string): RuntimeError {
  if (isRuntimeError(error)) return error;
  const candidate = error as { readonly status?: unknown; readonly name?: unknown; readonly message?: unknown } | undefined;
  const status = typeof candidate?.status === "number" ? candidate.status : undefined;
  const name = typeof candidate?.name === "string" ? candidate.name : "";
  const message = typeof candidate?.message === "string" ? candidate.message : String(error);
  if (name === "AbortError" || /\babort(?:ed|ing)?\b|operation was aborted/i.test(message)) return new RuntimeError({ code: "TURN_CANCELLED", recoverable: false, message: "当前回合已取消。" }, { cause: error });
  if (status === 401 || status === 403 || /authentication|unauthorized|forbidden|api key/i.test(message)) return new RuntimeError({ code: "PROVIDER_AUTH", recoverable: false, message: `${provider} 模型服务认证失败。` }, { cause: error });
  if (status === 429 || /rate.?limit|too many requests/i.test(message)) return new RuntimeError({ code: "PROVIDER_RATE_LIMIT", recoverable: true, message: `${provider} 模型服务请求过于频繁。` }, { cause: error });
  if (/timeout|timed out|deadline/i.test(name) || /timeout|timed out|deadline/i.test(message)) return new RuntimeError({ code: "PROVIDER_TIMEOUT", recoverable: true, message: `${provider} 模型服务请求超时。` }, { cause: error });
  if (/network|connection|fetch|socket|dns|econn|enotfound/i.test(name) || /network|connection|fetch|socket|dns|econn|enotfound/i.test(message)) return new RuntimeError({ code: "PROVIDER_NETWORK", recoverable: true, message: `${provider} 模型服务网络请求失败。` }, { cause: error });
  const safeDetail = message.replace(/(?:api[_-]?key|authorization|bearer)\s*[:=]?\s*[^\s,;]+/gi, "[redacted]").slice(0, 240);
  return new RuntimeError({ code: status !== undefined ? "PROVIDER_INVALID_RESPONSE" : "UNKNOWN", recoverable: false, message: status === undefined ? `${provider} 模型服务请求失败。` : `${provider} 模型服务返回了无法处理的响应（HTTP ${status}）：${safeDetail}` }, { cause: error });
}

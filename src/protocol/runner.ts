import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import type { ChatSession } from "../core/session.js";
import { parseProtocolRequest } from "./parser.js";
import { ProtocolWriter } from "./writer.js";
import { ProtocolApprovalService } from "./approval.js";
import { performance } from "node:perf_hooks";
export interface ProtocolSessionEvents {
  readonly onToolStarted: (tool: string, callId: string) => void;
  readonly onToolFinished: (tool: string, callId: string, result: { readonly ok: boolean; readonly code?: string }) => void;
}
export async function runProtocol(input: Readable, output: import("node:stream").Writable, session: ChatSession | undefined, provider: string, model: string, options: { readonly onNewSession?: () => void; readonly onToolStarted?: (id: string, tool: string) => void; readonly onToolFinished?: (id: string, tool: string) => void; readonly approvalService?: ProtocolApprovalService; readonly createSession?: (approvalService: ProtocolApprovalService, events: ProtocolSessionEvents) => ChatSession | Promise<ChatSession>; readonly sessionId?: () => string } = {}): Promise<void> {
  const writer = new ProtocolWriter(output);
  writer.write({ type: "ready", provider, model });
  const ids = new Set<string>();
  const rl = createInterface({ input, crlfDelay: Infinity });
  const iterator = rl[Symbol.asyncIterator]();
  let active: Promise<void> | undefined;
  let activeId: string | undefined;
  const approvalService = options.approvalService ?? (options.createSession ? new ProtocolApprovalService((approvalId, request) => writer.write({ type: "approval_request", id: activeId ?? "", approvalId, tool: request.toolName, permission: request.permission.kind, summary: request.summary })) : undefined);
  const events: ProtocolSessionEvents = {
    onToolStarted: (tool, callId) => writer.write({ type: "tool_start", id: activeId ?? "", tool }),
    onToolFinished: (tool, callId, result) => writer.write({ type: "tool_end", id: activeId ?? "", tool, ok: result.ok, ...(!result.ok && result.code ? { code: result.code as "UNKNOWN_TOOL" | "INVALID_ARGUMENTS" | "PERMISSION_DENIED" | "USER_REJECTED" | "EXECUTION_FAILED" | "SANDBOX_DENIED" } : {}) }),
  };
  let currentSession = options.createSession ? await options.createSession(approvalService as ProtocolApprovalService, events) : session;
  if (!currentSession) throw new Error("Protocol session is not configured");
  while (true) {
    const next = await iterator.next();
    if (next.done) {
      approvalService?.rejectPending();
      if (active) await active;
      break;
    }
    const line = next.value;
    if (!line.trim()) continue;
    let request;
    try { request = parseProtocolRequest(line); } catch (error) { writer.write({ type: "error", code: String(error instanceof Error ? error.message : error), message: "请求格式无效", recoverable: true }); continue; }
    if (ids.has(request.id)) { writer.write({ type: "error", id: request.id, code: "DUPLICATE_ID", message: "请求 id 已使用", recoverable: false }); continue; }
    ids.add(request.id);
    if (request.type === "exit") {
      approvalService?.rejectPending("协议请求已退出");
      if (active) await active;
      writer.write({ type: "bye", id: request.id });
      break;
    }
    if (request.type === "new_session") {
      if (active) { writer.write({ type: "error", id: request.id, code: "BUSY", message: "当前已有请求处理中", recoverable: true }); continue; }
      approvalService?.resetRemembered(); approvalService?.reopen(); currentSession = options.createSession ? await options.createSession(approvalService as ProtocolApprovalService, events) : currentSession; options.onNewSession?.(); writer.write({ type: "session_changed", id: request.id, sessionId: options.sessionId?.() ?? request.id }); continue;
    }
    if (request.type === "approval_response") {
      if (!approvalService?.resolve(request)) writer.write({ type: "error", id: request.id, code: "UNEXPECTED_APPROVAL", message: "当前没有等待中的审批", recoverable: true });
      continue;
    }
    if (request.type !== "prompt") continue;
    if (active) { writer.write({ type: "error", id: request.id, code: "BUSY", message: "当前已有请求处理中", recoverable: true }); continue; }
    const startedAt = performance.now();
    writer.write({ type: "response_start", id: request.id });
    activeId = request.id;
    active = (async () => {
      try {
        const response = await currentSession.sendStream(request.text, text => writer.write({ type: "response_delta", id: request.id, text }));
        writer.write({ type: "response_end", id: request.id, text: response.text, elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)) });
      } catch (error) {
        writer.write({ type: "error", id: request.id, code: classifyPromptError(error), message: safePromptErrorMessage(error), recoverable: true });
        writer.write({ type: "response_end", id: request.id, text: "", elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)) });
      }
    })().finally(() => { active = undefined; activeId = undefined; });
  }
}

function classifyPromptError(error: unknown): "PROVIDER_FAILED" | "PERSISTENCE_FAILED" | "PROMPT_FAILED" {
  const message = error instanceof Error ? error.message : String(error);
  if (/disk|session|lock|persist|permission|EPERM|EACCES/i.test(message)) return "PERSISTENCE_FAILED";
  if (/provider|network|timeout|fetch|connection/i.test(message)) return "PROVIDER_FAILED";
  return "PROMPT_FAILED";
}

function safePromptErrorMessage(error: unknown): string {
  const code = classifyPromptError(error);
  if (code === "PERSISTENCE_FAILED") return "会话状态保存失败，请检查会话目录权限。";
  if (code === "PROVIDER_FAILED") return "模型服务请求失败，请检查 Provider 配置或网络。";
  return "当前请求未完成。";
}

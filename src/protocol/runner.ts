import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import type { ChatSession } from "../core/session.js";
import { parseProtocolRequest } from "./parser.js";
import { ProtocolWriter } from "./writer.js";
import { ProtocolApprovalService } from "./approval.js";
import { performance } from "node:perf_hooks";
import type { ToolExecutionResult } from "../tools/types.js";
import { isRuntimeError, type RuntimeErrorCode } from "../core/errors.js";
import type { ProtocolCapabilities, ProtocolTaskSummary } from "./types.js";
import type { ModelStepEvent } from "../core/events.js";
import type { ModelCatalogEntry } from "../models/catalog.js";
import { ProtocolUserQuestionService } from "./questions.js";
import { summarizeTaskState, type TaskStateV1 } from "../core/task-state.js";
import type { VerificationStatus } from "../core/verification.js";
import type { SessionSearchHit, SessionQuery } from "../session-query.js";
import type { TaskStatus } from "../core/task-state.js";
export interface ProtocolSessionEvents {
  readonly onToolStarted: (tool: string, callId: string, argumentsJson?: string) => void;
  readonly onToolFinished: (tool: string, callId: string, result: ToolExecutionResult) => void;
  readonly onModelStepEvent: (event: ModelStepEvent) => void;
}
 export async function runProtocol(input: Readable, output: import("node:stream").Writable, session: ChatSession | undefined, provider: string, model: string, options: { readonly workspace?: string; readonly capabilities?: ProtocolCapabilities; readonly onNewSession?: () => void; readonly beforeNewSession?: () => Promise<void>; readonly onToolStarted?: (id: string, tool: string) => void; readonly onToolFinished?: (id: string, tool: string) => void; readonly approvalService?: ProtocolApprovalService; readonly questionService?: ProtocolUserQuestionService; readonly createSession?: (approvalService: ProtocolApprovalService, events: ProtocolSessionEvents, questionService: ProtocolUserQuestionService) => ChatSession | Promise<ChatSession>; readonly sessionId?: () => string; readonly listModels?: (query?: string) => Promise<readonly ModelCatalogEntry[]>; readonly useModel?: (model: string) => Promise<void>; readonly sessionQuery?: SessionQuery; readonly workspaceKey?: string; readonly selectSession?: (sessionId: string) => Promise<boolean> } = {}): Promise<void> {
  const writer = new ProtocolWriter(output);
  const ids = new Set<string>();
  const rl = createInterface({ input, crlfDelay: Infinity });
  const iterator = rl[Symbol.asyncIterator]();
  let active: Promise<void> | undefined;
  let activeId: string | undefined;
  const approvalService = options.approvalService ?? (options.createSession ? new ProtocolApprovalService((approvalId, request) => writer.write({ type: "approval_request", id: activeId ?? "", approvalId, tool: request.toolName, permission: request.permission.kind, summary: request.summary })) : undefined);
  const questionService = options.questionService ?? (options.createSession ? new ProtocolUserQuestionService((questionId, request) => writer.write({ type: "question_request", id: activeId ?? "", questionId, questions: request.questions })) : undefined);
  const events: ProtocolSessionEvents = {
    onToolStarted: (tool, callId, argumentsJson) => writer.write({ type: "tool_start", id: activeId ?? "", tool, callId, ...toolTraceFields(tool, argumentsJson) }),
    onToolFinished: (tool, callId, result) => writer.write({ type: "tool_end", id: activeId ?? "", tool, ok: result.ok, ...(!result.ok && result.code ? { code: result.code } : {}) }),
    onModelStepEvent: event => {
      const id = activeId ?? "";
      if (event.type === "model_step_start") writer.write({ type: "model_step_start", id, step: event.step, attempt: event.attempt });
      else if (event.type === "model_delta") writer.write({ type: "model_delta", id, step: event.step, attempt: event.attempt, text: event.text, provisional: true });
      else writer.write({ type: "model_step_end", id, step: event.step, attempt: event.attempt, result: event.result });
    },
  };
  let currentSession = options.createSession ? await options.createSession(approvalService as ProtocolApprovalService, events, questionService as ProtocolUserQuestionService) : session;
  if (!currentSession) throw new Error("Protocol session is not configured");
  writer.write({ type: "ready", provider, model, ...(options.workspace ? { workspace: options.workspace } : {}), ...(options.capabilities ? { capabilities: options.capabilities } : {}), ...taskReadyFields(currentSession) });
  while (true) {
    const next = await iterator.next();
    if (next.done) {
      currentSession.cancelActiveTurn?.({ kind: "disconnect" });
      approvalService?.rejectPending();
      questionService?.rejectPending();
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
      questionService?.rejectPending("协议请求已退出");
      if (active) await active;
      writer.write({ type: "bye", id: request.id });
      break;
    }
    if (request.type === "cancel") {
      if (!active || activeId !== request.targetId) {
        writer.write({ type: "error", id: request.id, code: "NOT_ACTIVE", message: "目标请求当前没有活动回合", recoverable: true });
      } else {
        const accepted = currentSession.cancelActiveTurn?.({ kind: "user" }) ?? false;
        writer.write({ type: "cancel_ack", id: request.id, targetId: request.targetId, accepted });
      }
      continue;
    }
    if (request.type === "models_list") {
      if (!options.listModels) writer.write({ type: "error", id: request.id, code: "UNSUPPORTED", message: "当前 Provider 不支持模型目录", recoverable: false });
      else try { writer.write({ type: "models_list", id: request.id, models: await options.listModels(request.query) } as never); } catch { writer.write({ type: "error", id: request.id, code: "MODEL_CATALOG_FAILED", message: "模型目录查询失败", recoverable: true }); }
      continue;
    }
    if (request.type === "models_use") {
      if (!options.useModel) writer.write({ type: "error", id: request.id, code: "UNSUPPORTED", message: "当前 Provider 不支持切换模型", recoverable: false });
      else try { await options.useModel(request.model); writer.write({ type: "model_changed", id: request.id, model: request.model, effective: "next_start" } as never); } catch { writer.write({ type: "error", id: request.id, code: "MODEL_CHANGE_FAILED", message: "模型切换失败", recoverable: true }); }
      continue;
    }
    if (request.type === "task_get") {
      const task = currentSession.taskState;
      writer.write({ type: "task_state", id: request.id, sessionId: options.sessionId?.() ?? "unknown", ...(task ? { task } : {}), verificationStatus: currentSession.verificationStatus });
      continue;
    }
    if (request.type === "sessions_list" || request.type === "sessions_search") {
      if (!options.sessionQuery || !options.workspaceKey) { writer.write({ type: "error", id: request.id, code: "UNSUPPORTED", message: "当前协议不支持历史 Session 查询", recoverable: false }); continue; }
      try {
        const result = await options.sessionQuery.search({ workspaceKey: options.workspaceKey, ...(request.type === "sessions_search" && request.query ? { query: request.query } : {}), ...(request.type === "sessions_search" && request.status ? { status: request.status } : {}) });
        writer.write({ type: "sessions_result", id: request.id, sessions: result.sessions, truncated: result.truncated });
      } catch (error) { writer.write({ type: "error", id: request.id, code: error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : "SESSION_QUERY_FAILED", message: "历史 Session 查询失败", recoverable: true }); }
      continue;
    }
    if (request.type === "session_select") {
      if (active) { writer.write({ type: "error", id: request.id, code: "BUSY", message: "当前已有请求处理中", recoverable: true }); continue; }
      if (!options.selectSession || !(await options.selectSession(request.sessionId))) { writer.write({ type: "error", id: request.id, code: "SESSION_QUERY_NOT_FOUND", message: "历史 Session 不存在", recoverable: true }); continue; }
      if (options.createSession) currentSession = await options.createSession(approvalService as ProtocolApprovalService, events, questionService as ProtocolUserQuestionService);
      writer.write({ type: "session_changed", id: request.id, sessionId: options.sessionId?.() ?? request.sessionId });
      continue;
    }
    if (request.type === "new_session") {
      if (active) { writer.write({ type: "error", id: request.id, code: "BUSY", message: "当前已有请求处理中", recoverable: true }); continue; }
      approvalService?.resetRemembered(); approvalService?.reopen(); questionService?.reopen(); await options.beforeNewSession?.(); currentSession = options.createSession ? await options.createSession(approvalService as ProtocolApprovalService, events, questionService as ProtocolUserQuestionService) : currentSession; options.onNewSession?.(); writer.write({ type: "session_changed", id: request.id, sessionId: options.sessionId?.() ?? request.id }); continue;
    }
    if (request.type === "approval_response") {
      if (!approvalService?.resolve(request)) writer.write({ type: "error", id: request.id, code: "UNEXPECTED_APPROVAL", message: "当前没有等待中的审批", recoverable: true });
      continue;
    }
    if (request.type === "question_response") {
      if (!questionService?.resolve(request)) writer.write({ type: "error", id: request.id, code: "UNEXPECTED_QUESTION_RESPONSE", message: "当前没有等待中的用户问题", recoverable: true });
      continue;
    }
    if (request.type !== "prompt") continue;
    if (active) { writer.write({ type: "error", id: request.id, code: "BUSY", message: "当前已有请求处理中", recoverable: true }); continue; }
    const startedAt = performance.now();
    writer.write({ type: "response_start", id: request.id });
    activeId = request.id;
    active = (async () => {
      try {
        const response = await currentSession.send(request.text);
        writer.write({ type: "response_end", id: request.id, text: response.text, ...(response.outcome ? { outcome: response.outcome } : {}), elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)), ...(response.projectSources?.length ? { projectSources: response.projectSources.map(source => ({ path: source.path, startLine: source.startLine })) } : {}), ...(response.verificationStatus ? { verificationStatus: response.verificationStatus } : {}) });
      } catch (error) {
        if (isRuntimeError(error) && error.code === "TURN_CANCELLED") writer.write({ type: "response_cancelled", id: request.id, elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)) });
        else writer.write({ type: "error", id: request.id, code: classifyPromptError(error), message: safePromptErrorMessage(error), recoverable: isRuntimeError(error) ? error.recoverable : true });
      }
    })().finally(() => { active = undefined; activeId = undefined; });
  }
  await writer.flush();
}

function taskReadyFields(session: ChatSession): { readonly task?: ProtocolTaskSummary; readonly verificationStatus?: VerificationStatus } {
  const task = session.taskState;
  const summary = task ? summarizeTaskState(task) : undefined;
  return {
    ...(summary ? {
      task: {
        status: summary.status,
        goal: summary.goal,
        completedSteps: summary.completedSteps,
        totalSteps: summary.totalSteps,
        blockerCount: summary.blockerCount,
      },
    } : {}),
    ...(session.verificationStatus !== "not_applicable" ? { verificationStatus: session.verificationStatus } : {}),
  };
}

function toolTraceFields(tool: string, argumentsJson?: string): { readonly query?: string; readonly url?: string } {
  if (tool !== "web_search" && tool !== "web_fetch") return {};
  try {
    const args = JSON.parse(argumentsJson ?? "") as Record<string, unknown>;
    if (tool === "web_search" && typeof args.query === "string") return { query: args.query.slice(0, 500) };
    if (tool === "web_fetch" && typeof args.url === "string") return { url: args.url.slice(0, 2000) };
  } catch { /* tool_end carries the validation failure */ }
  return {};
}

function classifyPromptError(error: unknown): RuntimeErrorCode | "PERSISTENCE_FAILED" | "PROMPT_FAILED" {
  if (isRuntimeError(error)) return error.code;
  const message = error instanceof Error ? error.message : String(error);
  if (/disk|session|lock|persist|permission|EPERM|EACCES/i.test(message)) return "PERSISTENCE_FAILED";
  if (/provider|network|timeout|fetch|connection/i.test(message)) return "PROVIDER_NETWORK";
  return "PROMPT_FAILED";
}

function safePromptErrorMessage(error: unknown): string {
  if (isRuntimeError(error)) return error.message;
  if (error instanceof Error && /^模型决策格式无效（输出长度 \d+）$/.test(error.message)) return error.message;
  const code = classifyPromptError(error);
  if (code === "PERSISTENCE_FAILED") return "会话状态保存失败，请检查会话目录权限。";
  if (code === "PROVIDER_NETWORK") return "模型服务请求失败，请检查 Provider 配置或网络。";
  return "当前请求未完成。";
}

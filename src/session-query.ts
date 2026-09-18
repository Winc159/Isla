import type { Message } from "./core/types.js";
import { summarizeTaskState, type TaskStateV1, type TaskStatus } from "./core/task-state.js";
import type { StoredSession, SessionStore } from "./session-store.js";

export interface SessionSearchQuery {
  readonly workspaceKey: string;
  readonly query?: string;
  readonly status?: TaskStatus;
  readonly currentSessionId?: string;
}

export interface SessionTaskSummary {
  readonly status: TaskStatus;
  readonly goal: string;
  readonly completedSteps: number;
  readonly totalSteps: number;
  readonly blockerCount: number;
}

export interface SessionSearchHit {
  readonly sessionId: string;
  readonly provider: string;
  readonly model: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly task?: SessionTaskSummary;
  readonly excerpt: string;
}

export interface SessionContextReadQuery {
  readonly workspaceKey: string;
  readonly sessionId: string;
  readonly anchorMessageIndex?: number;
}

export interface SessionContextReadResult {
  readonly sessionId: string;
  readonly provider: string;
  readonly model: string;
  readonly messages: readonly { readonly index: number; readonly role: "user" | "assistant"; readonly content: string }[];
  readonly truncated: boolean;
}

export const SESSION_QUERY_MAX_RESULTS = 10;
export const SESSION_QUERY_MAX_EXCERPT_CHARS = 600;
export const SESSION_QUERY_MAX_READ_CHARS = 6000;

export class SessionQueryError extends Error {
  constructor(readonly code: "SESSION_QUERY_INVALID" | "SESSION_QUERY_NOT_FOUND" | "SESSION_QUERY_UNAUTHORIZED" | "SESSION_QUERY_TOO_LARGE" | "SESSION_QUERY_FAILED", message: string) {
    super(message);
    this.name = "SessionQueryError";
  }
}

export class SessionQuery {
  constructor(private readonly store: SessionStore) {}

  async search(query: SessionSearchQuery): Promise<{ readonly sessions: readonly SessionSearchHit[]; readonly truncated: boolean }> {
    validateWorkspaceKey(query.workspaceKey);
    const sessions = await this.loadWorkspaceSessions(query.workspaceKey);
    const needle = query.query?.trim().toLocaleLowerCase();
    if (query.query !== undefined && !needle) throw new SessionQueryError("SESSION_QUERY_INVALID", "搜索词不能为空");
    const hits = sessions
      .filter(session => session.version === 4)
      .filter(session => !query.status || session.task?.status === query.status)
      .map(session => ({ session, hit: projectSearchHit(session) }))
      .filter(item => !needle || searchableText(item.hit).toLocaleLowerCase().includes(needle))
      .filter(item => item.session.id !== query.currentSessionId)
      .sort((left, right) => right.session.updatedAt.localeCompare(left.session.updatedAt) || left.session.id.localeCompare(right.session.id));
    return { sessions: hits.slice(0, SESSION_QUERY_MAX_RESULTS).map(item => item.hit), truncated: hits.length > SESSION_QUERY_MAX_RESULTS };
  }

  async read(query: SessionContextReadQuery): Promise<SessionContextReadResult> {
    validateWorkspaceKey(query.workspaceKey);
    if (query.anchorMessageIndex !== undefined && (!Number.isInteger(query.anchorMessageIndex) || query.anchorMessageIndex < 0)) throw new SessionQueryError("SESSION_QUERY_INVALID", "anchorMessageIndex 无效");
    const sessions = await this.loadWorkspaceSessions(query.workspaceKey);
    const session = sessions.find(item => item.version === 4 && item.id === query.sessionId);
    if (!session) throw new SessionQueryError("SESSION_QUERY_NOT_FOUND", "历史 Session 不存在");
    const projected = projectReadableMessages(session.messages);
    const anchorIndex = query.anchorMessageIndex;
    const anchor = anchorIndex === undefined ? projected.length - 1 : projected.findIndex(message => message.index >= anchorIndex);
    const start = Math.max(0, (anchor < 0 ? projected.length : anchor) - 6);
    const selected: typeof projected = [];
    let chars = 0;
    for (let index = start; index < projected.length; index += 1) {
      const message = projected[index]!;
      const next = chars + message.content.length;
      if (selected.length > 0 && next > SESSION_QUERY_MAX_READ_CHARS) return { sessionId: session.id, provider: session.provider, model: session.model, messages: selected, truncated: true };
      selected.push(message); chars = next;
    }
    return { sessionId: session.id, provider: session.provider, model: session.model, messages: selected, truncated: selected.length < projected.length };
  }

  async getSession(workspaceKey: string, sessionId: string): Promise<StoredSession | undefined> {
    validateWorkspaceKey(workspaceKey);
    const sessions = await this.loadWorkspaceSessions(workspaceKey);
    return sessions.find(session => session.version === 4 && session.id === sessionId);
  }

  private async loadWorkspaceSessions(workspaceKey: string): Promise<readonly StoredSession[]> {
    if (!this.store.listAll) throw new SessionQueryError("SESSION_QUERY_FAILED", "当前 Session Store 不支持历史查询");
    try { return (await this.store.listAll()).filter(session => session.version === 4 && session.workspaceKey === workspaceKey); }
    catch { throw new SessionQueryError("SESSION_QUERY_FAILED", "历史 Session 查询失败"); }
  }
}

function projectSearchHit(session: Extract<StoredSession, { version: 4 }>): SessionSearchHit {
  const task = session.task ? taskSummary(session.task) : undefined;
  const source = task?.goal ?? session.context?.checkpoint?.content ?? session.messages.find(message => message.role === "user")?.content ?? "新对话";
  return { sessionId: session.id, provider: session.provider, model: session.model, createdAt: session.createdAt, updatedAt: session.updatedAt, ...(task ? { task } : {}), excerpt: redact(source).replaceAll(/\s+/g, " ").slice(0, SESSION_QUERY_MAX_EXCERPT_CHARS) };
}

function taskSummary(task: TaskStateV1): SessionTaskSummary {
  const summary = summarizeTaskState(task);
  return { status: summary.status, goal: summary.goal, completedSteps: summary.completedSteps, totalSteps: summary.totalSteps, blockerCount: summary.blockerCount };
}

function searchableText(hit: SessionSearchHit): string { return [hit.excerpt, hit.task?.goal].filter(Boolean).join(" "); }

function projectReadableMessages(messages: readonly Message[]): { readonly index: number; readonly role: "user" | "assistant"; readonly content: string }[] {
  return messages.flatMap((message, index) => message.role === "user" || message.role === "assistant" ? [{ index, role: message.role, content: redact(message.content) }] : []);
}

function redact(content: string): string {
  return content
    .replaceAll(/bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replaceAll(/(api[_ -]?key|token|authorization|password|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replaceAll(/\.env[^\n]*/gi, ".env [REDACTED]");
}

function validateWorkspaceKey(value: string): void {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new SessionQueryError("SESSION_QUERY_INVALID", "workspaceKey 无效");
}

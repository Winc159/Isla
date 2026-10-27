import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Server } from 'node:http';
import { open, unlink } from 'node:fs/promises';
import type { ChatSession } from '../core/session.js';
import type { SessionStore, StoredSession } from '../sessions/store.js';
import type { CapabilitySnapshot } from '../capabilities/snapshot.js';
import type { StructuredInferenceRequestV1, StructuredInferenceSuccessV1 } from '../resource/contracts.js';
import type { Message } from '../core/types.js';
import type { ModelStepEvent } from '../core/events.js';
import type { ToolExecutionResult } from '../tools/types.js';
import type { ApprovalRequest, ApprovalService, ApprovalDecision } from '../approval/types.js';
import type { UserQuestionRequest, UserQuestionResult, UserQuestionService, UserQuestionAnswer } from '../user-questions/types.js';
import { workspaceKey } from '../sessions/workspace.js';
import { resolveWorkspace } from '../config/workspace.js';
import { measureContextBudget, DEFAULT_CONTEXT_RETAIN_TURNS, DEFAULT_MAX_CONTEXT_CHARS } from '../core/context.js';
import { estimateRequestTokens } from '../core/token-budget.js';
import { DEFAULT_MAX_CONTEXT_TURNS } from '../core/session.js';
import type { AgentRegistry } from '../core/service-kernel.js';
import type { FileEventStore } from '../core/event-store.js';

export interface ResidentHostOptions {
  readonly host?: string;
  readonly port?: number;
  readonly token?: string;
  readonly provider: string;
  readonly model: string;
  readonly sessionStore: SessionStore;
  readonly createSession: (stored: StoredSession, workspaceRoot?: string, events?: HostTurnObservers) => ChatSession;
  readonly capabilitySnapshot?: () => CapabilitySnapshot;
  readonly agentRegistry?: AgentRegistry;
  readonly eventStore?: FileEventStore;
  readonly maxActiveTurns?: number;
  readonly lockPath?: string;
  readonly structuredInference?: (request: StructuredInferenceRequestV1, signal: AbortSignal) => Promise<StructuredInferenceSuccessV1<unknown>>;
  readonly initialMessages?: readonly Message[];
  readonly memoryStore?: import('../memory/store.js').MemoryStore;
  readonly contextLimits?: { readonly maxContextTurns: number; readonly maxContextChars: number; readonly maxContextTokens: number; readonly maxOutputTokens: number; readonly contextReserveTokens: number; readonly contextRetainTurns: number };
}

export type HostTurnObservers = {
  readonly turnId: string;
  readonly onModelStepEvent: (event: ModelStepEvent) => void;
  readonly onToolStarted: (tool: string, callId: string) => void;
  readonly onToolFinished: (tool: string, callId: string, result: ToolExecutionResult) => void;
  readonly approvalService?: ApprovalService;
  readonly userQuestionService?: UserQuestionService;
};

export type HostTurnEvent =
  | { readonly type: 'turn_start'; readonly sessionId: string; readonly turnId: string }
  | ModelStepEvent
  | { readonly type: 'tool_start'; readonly tool: string; readonly callId: string }
  | { readonly type: 'tool_end'; readonly tool: string; readonly callId: string; readonly ok: boolean; readonly code?: string }
  | { readonly type: 'approval_requested'; readonly approvalId: string; readonly tool: string; readonly permission: string; readonly summary: string }
  | { readonly type: 'question_requested'; readonly questionId: string; readonly questions: UserQuestionRequest['questions'] }
  | { readonly type: 'turn_completed'; readonly sessionId: string; readonly turnId: string; readonly text: string; readonly outcome: string }
  | { readonly type: 'turn_failed'; readonly sessionId: string; readonly turnId: string; readonly code: string }
  | { readonly type: 'turn_cancelled'; readonly sessionId: string; readonly turnId: string };

type ActiveTurn = { readonly turnId: string; readonly session: ChatSession; readonly interactions: RemoteInteractions };
const MAX_EVENT_BYTES = 64 * 1024;
const MAX_STREAM_BUFFER_BYTES = 1024 * 1024;
const MAX_REQUEST_BYTES = 1024 * 1024;

export class ResidentHost {
  readonly token: string;
  private readonly host: string;
  private readonly port: number;
  private readonly maxActiveTurns: number;
  private readonly active = new Map<string, ActiveTurn>();
  private server: Server | undefined;
  private closed = false;
  private lockHandle: Awaited<ReturnType<typeof open>> | undefined;

  constructor(private readonly options: ResidentHostOptions) {
    this.host = options.host ?? '127.0.0.1';
    if (!isLoopback(this.host)) throw new Error('HOST_LOOPBACK_REQUIRED');
    this.port = options.port ?? 0;
    this.maxActiveTurns = options.maxActiveTurns ?? 4;
    this.token = options.token ?? randomBytes(32).toString('hex');
  }

  async start(): Promise<{ readonly host: string; readonly port: number; readonly token: string }> {
    if (this.server) throw new Error('HOST_ALREADY_STARTED');
    if (this.options.lockPath) { try { this.lockHandle = await open(this.options.lockPath, 'wx'); await this.lockHandle.writeFile(JSON.stringify({ pid: process.pid })); } catch { throw new Error('HOST_ALREADY_RUNNING'); } }
    this.server = createServer((request, response) => { void this.handle(request, response); });
    await new Promise<void>((resolve, reject) => { this.server!.once('error', reject); this.server!.listen(this.port, this.host, () => resolve()); });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('HOST_ADDRESS_UNAVAILABLE');
    return { host: this.host, port: address.port, token: this.token };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const active of this.active.values()) active.session.cancelActiveTurn({ kind: 'shutdown' });
    await Promise.all([...this.active.values()].map(active => active.session.whenIdle()));
    this.active.clear();
    if (this.server) await new Promise<void>(resolve => this.server!.close(() => resolve()));
    this.server = undefined;
    await this.lockHandle?.close().catch(() => undefined);
    this.lockHandle = undefined;
    if (this.options.lockPath) await unlink(this.options.lockPath).catch(() => undefined);
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('content-type', 'application/json; charset=utf-8');
    if (request.method === 'GET' && request.url === '/health') { this.send(response, 200, { ok: true, apiVersion: 2, ready: Boolean(this.server), active: this.active.size }); return; }
    if (!this.authorized(request)) { this.send(response, 401, { error: 'UNAUTHORIZED' }); return; }
    try {
      const url = new URL(request.url ?? '/', `http://${this.host}`);
      if (request.method === 'GET' && url.pathname === '/api/v1/inference/status') { this.send(response, 200, { configured: Boolean(this.options.structuredInference) }); return; }
      if (request.method === 'POST' && url.pathname === '/api/v1/inference/structured') { await this.structuredInference(request, response); return; }
      if (request.method === 'GET' && url.pathname === '/capabilities') { this.send(response, 200, this.options.capabilitySnapshot?.() ?? { version: 1, hash: '', entries: [] }); return; }
      if (request.method === 'GET' && url.pathname === '/sessions') { this.send(response, 200, { sessions: await this.list(url.searchParams.get('workspaceKey') ?? undefined) }); return; }
      if (request.method === 'POST' && url.pathname === '/quick') { await this.quick(await readJson(request), response, request.headers.accept?.includes('application/x-ndjson') === true, request); return; }
      if (request.method === 'POST' && url.pathname === '/sessions') { const body = await readJson(request); if (typeof body.workspaceKey !== 'string' || !body.workspaceKey) { this.send(response, 400, { error: 'WORKSPACE_REQUIRED' }); return; } const session = await this.options.sessionStore.create(this.options.provider, this.options.model, this.options.initialMessages ?? [], body.workspaceKey); this.send(response, 201, { sessionId: session.id }); return; }
      if (request.method === 'GET' && url.pathname === '/memory') { const store = this.options.memoryStore; if (!store) { this.send(response, 503, { error: 'MEMORY_UNAVAILABLE' }); return; } const action = url.searchParams.get('action') ?? 'list'; const id = url.searchParams.get('id'); const status = url.searchParams.get('status'); if (action === 'list') { this.send(response, 200, { records: store.list(status ? { status } : {}).slice(0, 100).map(record => ({ id: record.id, scope: record.scope, kind: record.kind, status: record.status, revision: record.revision, updatedAt: record.updatedAt })) }); return; } if (action === 'show' && id) { const record = store.get(id); this.send(response, record ? 200 : 404, record ? { id: record.id, scope: record.scope, kind: record.kind, status: record.status, content: record.content.slice(0, 4000), revision: record.revision, updatedAt: record.updatedAt } : { error: 'MEMORY_NOT_FOUND' }); return; } this.send(response, 400, { error: 'INVALID_MEMORY_QUERY' }); return; }
      if (request.method === 'POST' && url.pathname.startsWith('/memory/')) { const id = decodeURIComponent(url.pathname.slice('/memory/'.length)); const body = await readJson(request); const record = this.options.memoryStore?.get(id); if (!record) { this.send(response, 404, { error: 'MEMORY_NOT_FOUND' }); return; } if (!Number.isInteger(body.expectedRevision)) { this.send(response, 400, { error: 'REVISION_REQUIRED' }); return; } const updated = this.options.memoryStore!.disable(id, body.expectedRevision as number); this.send(response, 200, { id: updated.id, status: updated.status, revision: updated.revision }); return; }
      const match = url.pathname.match(/^\/sessions\/([^/]+)(?:\/(prompt|cancel|events|history|trace|context|plan|checkpoints|interactions\/([^/]+)))?$/);
      if (!match) { this.send(response, 404, { error: 'NOT_FOUND' }); return; }
      const session = await this.find(match[1]!);
      if (!session) { this.send(response, 404, { error: 'SESSION_NOT_FOUND' }); return; }
      if (request.method === 'GET' && !match[2]) { this.send(response, 200, safeSession(session)); return; }
      if (request.method === 'GET' && match[2] === 'plan') { this.send(response, 200, { plan: 'workPlan' in session ? session.workPlan : undefined, mode: 'workMode' in session ? session.workMode : undefined }); return; }
      if (request.method === 'GET' && match[2] === 'checkpoints') { const root=url.searchParams.get('workspaceRoot'); if(!root||!('workspaceKey'in session)||workspaceKey(await resolveWorkspace(root,undefined,process.cwd()))!==session.workspaceKey){this.send(response,400,{error:'WORKSPACE_MISMATCH'});return;}const work=this.options.createSession(session,root);try{this.send(response,200,{checkpoints:await work.listWorkspaceCheckpoints()});}finally{await work.close();}return; }
      if (request.method === 'POST' && match[2] === 'checkpoints') { const body=await readJson(request);const root=typeof body.workspaceRoot==='string'?await resolveWorkspace(body.workspaceRoot,undefined,process.cwd()):undefined;if(!root||!('workspaceKey'in session)||workspaceKey(root)!==session.workspaceKey){this.send(response,400,{error:'WORKSPACE_MISMATCH'});return;}const work=this.options.createSession(session,root);try{if(body.action==='preview'&&typeof body.id==='string'){this.send(response,200,await work.previewWorkspaceCheckpoint(body.id));return;}if(body.action==='restore'&&typeof body.id==='string'&&body.approved===true){await work.restoreWorkspaceCheckpoint(body.id,true);this.send(response,200,{restored:true,id:body.id});return;}this.send(response,400,{error:body.action==='restore'?'CHECKPOINT_RESTORE_REQUIRES_APPROVAL':'INVALID_CHECKPOINT_OPERATION'});}finally{await work.close();}return;}
      if (request.method === 'POST' && match[2] === 'plan') {
        const body = await readJson(request);
        const root = typeof body.workspaceRoot === 'string' ? await resolveWorkspace(body.workspaceRoot, undefined, process.cwd()) : undefined;
        if (!root || !('workspaceKey' in session) || workspaceKey(root) !== session.workspaceKey) { this.send(response, 400, { error: 'WORKSPACE_MISMATCH' }); return; }
        if (this.active.has(session.id)) { this.send(response, 409, { error: 'SESSION_BUSY' }); return; }
        const work = this.options.createSession(session, root);
        try {
          if (body.action === 'mode' && (body.mode === 'plan' || body.mode === 'act' || body.mode === 'review')) await work.setWorkMode(body.mode, body.mode === 'act' && body.approvePlanRevision === work.currentWorkPlan?.revision);
          else if (body.action === 'update' && body.plan && Number.isInteger(body.expectedRevision)) await work.updateWorkPlan(body.plan as import('../core/work-plan.js').WorkPlanV1, body.expectedRevision as number);
          else { this.send(response, 400, { error: 'INVALID_PLAN_OPERATION' }); await work.close(); return; }
          this.send(response, 200, { plan: work.currentWorkPlan, mode: work.currentWorkMode });
        } finally { await work.close(); }
        return;
      }
      if (request.method === 'GET' && match[2] === 'history') { const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50)); const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0); const visible = session.messages.filter(message => (message.role === 'user' || message.role === 'assistant') && !message.toolCalls?.length); const messages = visible.slice(offset, offset + limit).map(message => ({ role: message.role, content: message.content.slice(0, 8000) })); this.send(response, 200, { sessionId: session.id, offset, limit, total: visible.length, messages }); return; }
      if (request.method === 'GET' && match[2] === 'trace') { const turns = ('journal' in session ? session.journal?.turns ?? [] : []).slice(-20).map(turn => ({ sequence: turn.sequence, status: turn.status, startedAt: turn.startedAt, endedAt: turn.endedAt, attempts: turn.attempts.length, tools: turn.actions.filter(action => action.type === 'tool').map(action => action.tool), error: turn.error?.code })); this.send(response, 200, { turns }); return; }
      if (request.method === 'GET' && match[2] === 'context') { const limits = this.options.contextLimits ?? { maxContextTurns: DEFAULT_MAX_CONTEXT_TURNS, maxContextChars: DEFAULT_MAX_CONTEXT_CHARS, maxContextTokens: 0, maxOutputTokens: 0, contextReserveTokens: 0, contextRetainTurns: DEFAULT_CONTEXT_RETAIN_TURNS }; const checkpoint = 'context' in session ? session.context?.checkpoint : undefined; const report = measureContextBudget(session.messages, { maxTurns: limits.maxContextTurns, maxChars: limits.maxContextChars }, checkpoint); const estimatedTokens = estimateRequestTokens({ messages: session.messages }); this.send(response, 200, { ...report, estimatedTokens, maxContextTokens: limits.maxContextTokens, maxOutputTokens: limits.maxOutputTokens, contextReserveTokens: limits.contextReserveTokens, retainTurns: limits.contextRetainTurns }); return; }
      if (request.method === 'GET' && match[2] === 'events') { const after = Math.max(0, Number(url.searchParams.get('after') ?? 0) || 0); const events = this.options.eventStore ? await this.options.eventStore.read(session.id, after) : []; response.statusCode = 200; response.setHeader('content-type', 'text/event-stream; charset=utf-8'); response.setHeader('cache-control', 'no-cache'); response.setHeader('connection', 'keep-alive'); response.write(`event: session\ndata: ${JSON.stringify(safeSession(session))}\n\n`); if (events.length) response.write(`event: events\ndata: ${JSON.stringify({ sessionId: session.id, cursor: events.at(-1)!.sequence, events })}\n\n`); response.end(); return; }
      if (request.method === 'POST' && match[2] === 'cancel') { const body = await readJson(request); const active = this.active.get(session.id); const accepted = Boolean(active && body.turnId === active.turnId && active.session.cancelActiveTurn({ kind: 'user' })); this.send(response, 200, { accepted }); return; }
      if (request.method === 'POST' && match[2] === 'prompt') { const body = await readJson(request); let root: string | undefined; if (typeof body.workspaceRoot === 'string') { root = await resolveWorkspace(body.workspaceRoot, undefined, process.cwd()); if (!('workspaceKey' in session) || workspaceKey(root) !== session.workspaceKey) { this.send(response, 400, { error: 'WORKSPACE_MISMATCH' }); return; } } await this.prompt(session, body, response, root, request.headers.accept?.includes('application/x-ndjson') === true, request, true); return; }
      if (request.method === 'POST' && match[2]?.startsWith('interactions/') && match[3]) { const body = await readJson(request); const active = this.active.get(session.id); const accepted = Boolean(active && body.turnId === active.turnId && active.interactions.respond(match[3], body)); this.send(response, accepted ? 200 : 409, { accepted }); return; }
      this.send(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    } catch (error) { this.send(response, 400, { error: error instanceof Error ? error.message : 'HOST_REQUEST_FAILED' }); }
  }

  private async prompt(stored: StoredSession, body: Record<string, unknown>, response: ServerResponse, workspaceRoot?: string, stream = false, request?: IncomingMessage, interactive = false): Promise<void> {
    if (typeof body.text !== 'string') { this.send(response, 400, { error: 'PROMPT_REQUIRED' }); return; }
    const promptText = body.text;
    if (!promptText.trim()) { this.send(response, 400, { error: 'PROMPT_REQUIRED' }); return; }
    if (this.active.size >= this.maxActiveTurns) { this.send(response, 429, { error: 'HOST_BUSY' }); return; }
    if (this.active.has(stored.id)) { this.send(response, 409, { error: 'SESSION_BUSY' }); return; }
    const turnId = randomUUID();
    const interactions = new RemoteInteractions((event) => { if (stream) this.writeEvent(response, event); });
    const session = this.options.createSession(stored, workspaceRoot, stream ? {
      turnId,
      onModelStepEvent: event => this.writeEvent(response, event),
      onToolStarted: (tool, callId) => this.writeEvent(response, { type: 'tool_start', tool, callId }),
      onToolFinished: (tool, callId, result) => this.writeEvent(response, { type: 'tool_end', tool, callId, ok: result.ok, ...(!result.ok ? { code: safeCode(result.code) } : {}) }),
      ...(interactive ? { approvalService: interactions, userQuestionService: interactions } : {}),
    } : undefined);
    const active = { turnId, session, interactions };
    this.active.set(stored.id, active);
    if (stream) {
      response.statusCode = 200;
      response.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
      response.setHeader('cache-control', 'no-cache, no-transform');
      response.setHeader('connection', 'keep-alive');
      this.writeEvent(response, { type: 'turn_start', sessionId: stored.id, turnId });
    }
    const cancelForDisconnect = () => { if (!response.writableEnded) session.cancelActiveTurn({ kind: 'disconnect' }); };
    request?.on('aborted', cancelForDisconnect);
    response.on('close', cancelForDisconnect);
    try {
      const result = await session.send(promptText);
      if (stream) this.writeEvent(response, { type: 'turn_completed', sessionId: stored.id, turnId, text: result.text, outcome: result.outcome ?? 'completed' });
      else this.send(response, 200, { sessionId: stored.id, text: result.text, outcome: result.outcome });
    } catch (error) {
      if (stream) {
        if (session.currentTurnPhase === 'cancelled') this.writeEvent(response, { type: 'turn_cancelled', sessionId: stored.id, turnId });
        else this.writeEvent(response, { type: 'turn_failed', sessionId: stored.id, turnId, code: safeTurnErrorCode(error) });
      } else if (!response.writableEnded) this.send(response, 500, { error: safeTurnErrorCode(error) });
    } finally {
      request?.off('aborted', cancelForDisconnect);
      response.off('close', cancelForDisconnect);
      await this.options.agentRegistry?.disposeSession(stored.id);
      if (this.active.get(stored.id) === active) this.active.delete(stored.id);
      interactions.close();
      if (stream && !response.writableEnded) response.end();
    }
  }

  private async quick(body: Record<string, unknown>, response: ServerResponse, stream = false, request?: IncomingMessage): Promise<void> {
    if (typeof body.text !== 'string' || !body.text.trim()) { this.send(response, 400, { error: 'PROMPT_REQUIRED' }); return; }
    if (typeof body.workspaceKey !== 'string' || !body.workspaceKey) { this.send(response, 400, { error: 'WORKSPACE_REQUIRED' }); return; }
    if (typeof body.workspaceRoot !== 'string' || !body.workspaceRoot) { this.send(response, 400, { error: 'WORKSPACE_REQUIRED' }); return; }
    const root = await resolveWorkspace(body.workspaceRoot, undefined, process.cwd());
    if (workspaceKey(root) !== body.workspaceKey) { this.send(response, 400, { error: 'WORKSPACE_MISMATCH' }); return; }
    const sessions = this.options.sessionStore.listAll ? await this.options.sessionStore.listAll() : await this.options.sessionStore.list(this.options.provider, this.options.model);
    const stored = body.newSession === true
      ? await this.options.sessionStore.create(this.options.provider, this.options.model, this.options.initialMessages ?? [], body.workspaceKey)
      : sessions.find(item => item.provider === this.options.provider && item.model === this.options.model && (item.version === 4 || item.version === 5) && item.workspaceKey === body.workspaceKey)
        ?? await this.options.sessionStore.create(this.options.provider, this.options.model, this.options.initialMessages ?? [], body.workspaceKey);
    await this.prompt(stored, { text: body.text }, response, root, stream, request);
  }

  private writeEvent(response: ServerResponse, event: HostTurnEvent | ModelStepEvent): void {
    if (response.destroyed || response.writableEnded) return;
    const line = `${JSON.stringify(event)}\n`;
    if (Buffer.byteLength(line, 'utf8') > MAX_EVENT_BYTES) { response.destroy(new Error('HOST_EVENT_TOO_LARGE')); return; }
    if (response.writableLength + Buffer.byteLength(line, 'utf8') > MAX_STREAM_BUFFER_BYTES) { response.destroy(new Error('HOST_STREAM_BACKPRESSURE_LIMIT')); return; }
    response.write(line);
  }

  private async structuredInference(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!this.options.structuredInference) { this.send(response, 503, { error: { code: 'ROLE_NOT_CONFIGURED', message: 'resource-worker 未配置。', retryable: false } }); return; }
    const controller = new AbortController();
    request.on('aborted', () => controller.abort());
    try {
      const result = await this.options.structuredInference(await readJson(request) as unknown as StructuredInferenceRequestV1, controller.signal);
      this.send(response, 200, result);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'MODEL_RESPONSE_INVALID';
      const retryable = code === 'MODEL_UNAVAILABLE' || code === 'INFERENCE_BUSY' || code === 'INFERENCE_TIMEOUT' || code === 'MODEL_RESPONSE_INVALID';
      this.send(response, retryable ? 503 : 400, { error: { code, message: safeInferenceMessage(code), retryable } });
    }
  }

  private async list(workspace?: string): Promise<readonly object[]> { const sessions = this.options.sessionStore.listAll ? await this.options.sessionStore.listAll() : await this.options.sessionStore.list(this.options.provider, this.options.model); return sessions.filter(item => item.provider === this.options.provider && item.model === this.options.model && (!workspace || ('workspaceKey' in item && item.workspaceKey === workspace))).slice(0, 100).map(safeSession); }
  private async find(id: string): Promise<StoredSession | undefined> { const sessions = this.options.sessionStore.listAll ? await this.options.sessionStore.listAll() : await this.options.sessionStore.list(this.options.provider, this.options.model); return sessions.find(item => item.id === id && item.provider === this.options.provider && item.model === this.options.model); }
  private authorized(request: IncomingMessage): boolean { const value = request.headers.authorization; if (!value?.startsWith('Bearer ')) return false; const provided = Buffer.from(value.slice(7)); const expected = Buffer.from(this.token); return provided.length === expected.length && timingSafeEqual(provided, expected); }
  private send(response: ServerResponse, status: number, body: unknown): void { response.statusCode = status; response.end(JSON.stringify(body)); }
}

class RemoteInteractions implements ApprovalService, UserQuestionService {
  private readonly pending = new Map<string, { kind: 'approval'; resolve: (value: ApprovalDecision) => void; cleanup: () => void } | { kind: 'question'; resolve: (value: UserQuestionResult) => void; reject: (error: Error) => void; ids: readonly string[]; cleanup: () => void }>();
  constructor(private readonly emit: (event: HostTurnEvent) => void) {}
  request(request: ApprovalRequest, options: { signal?: AbortSignal } = {}): Promise<ApprovalDecision> {
    const approvalId = randomUUID();
    if (this.pending.size) return Promise.resolve({ approved: false, reason: '已有交互待处理。' });
    return new Promise(resolve => { const done = (value: ApprovalDecision) => { this.pending.delete(approvalId); options.signal?.removeEventListener('abort', abort); resolve(value); }; const abort = () => done({ approved: false, reason: '当前回合已取消。' }); this.pending.set(approvalId, { kind: 'approval', resolve: done, cleanup: abort }); options.signal?.addEventListener('abort', abort, { once: true }); this.emit({ type: 'approval_requested', approvalId, tool: safeLabel(request.toolName), permission: request.permission.kind, summary: safeSummary(request.summary) }); if (options.signal?.aborted) abort(); });
  }
  ask(request: UserQuestionRequest, options: { signal?: AbortSignal } = {}): Promise<UserQuestionResult> {
    if (this.pending.size) return Promise.reject(new Error('INTERACTION_ALREADY_PENDING'));
    const questionId = randomUUID();
    const questions = request.questions.slice(0, 8).map(question => ({ id: question.id.slice(0, 128), question: question.question.slice(0, 2000), ...(question.header ? { header: question.header.slice(0, 80) } : {}), ...(question.options ? { options: question.options.slice(0, 10).map(option => ({ label: option.label.slice(0, 200), ...(option.description ? { description: option.description.slice(0, 500) } : {}) })) } : {}), ...(question.multiSelect !== undefined ? { multiSelect: question.multiSelect } : {}) }));
    return new Promise((resolve, reject) => { const cleanup = () => options.signal?.removeEventListener('abort', abort); const abort = () => { this.pending.delete(questionId); cleanup(); reject(new Error('TURN_CANCELLED')); }; this.pending.set(questionId, { kind: 'question', resolve, reject, ids: questions.map(question => question.id), cleanup }); options.signal?.addEventListener('abort', abort, { once: true }); this.emit({ type: 'question_requested', questionId, questions }); if (options.signal?.aborted) abort(); });
  }
  respond(id: string, body: Record<string, unknown>): boolean {
    const pending = this.pending.get(id); if (!pending) return false;
    if (pending.kind === 'approval') { if (typeof body.approved !== 'boolean' || body.remember !== undefined) return false; this.pending.delete(id); pending.cleanup(); pending.resolve(body.approved ? { approved: true } : { approved: false, reason: '用户拒绝了工具调用' }); return true; }
    if (!Array.isArray(body.answers)) return false; const answers = body.answers as UserQuestionAnswer[]; const ids = answers.map(answer => answer?.id); if (answers.some(answer => !answer || typeof answer.id !== 'string' || !Array.isArray(answer.selected) || answer.selected.some(value => typeof value !== 'string') || answer.custom !== undefined && typeof answer.custom !== 'string') || ids.length !== pending.ids.length || new Set(ids).size !== ids.length || pending.ids.some(value => !ids.includes(value))) return false;
    this.pending.delete(id); pending.cleanup(); pending.resolve({ answers }); return true;
  }
  close(): void { for (const item of this.pending.values()) { if (item.kind === 'approval') item.cleanup(); else { item.cleanup(); item.reject(new Error('TURN_CANCELLED')); } } this.pending.clear(); }
}
function safeLabel(value: string): string { return /^[a-z0-9_.-]{1,64}$/iu.test(value) ? value : 'tool'; }
function safeSummary(value: string): string { return value.replaceAll(/[\r\n\t]/gu, ' ').replaceAll(/(?:[A-Za-z]:\\|\\\\)[^\s"']+/gu, '[路径已隐藏]').replaceAll(/\/(?:Users|home|private|root)\/[^\s"']+/gu, '[路径已隐藏]').slice(0, 500); }

function isLoopback(host: string): boolean { return host === '127.0.0.1' || host === '::1' || host === 'localhost'; }
function safeSession(session: StoredSession): { readonly sessionId: string; readonly provider: string; readonly model: string; readonly updatedAt: string } { return { sessionId: session.id, provider: session.provider, model: session.model, updatedAt: session.updatedAt }; }
async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> { const chunks: Buffer[] = []; let bytes = 0; for await (const chunk of request) { const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); bytes += value.length; if (bytes > MAX_REQUEST_BYTES) throw new Error('REQUEST_TOO_LARGE'); chunks.push(value); } const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_JSON'); return value as Record<string, unknown>; }
function safeInferenceMessage(code: string): string { return code === 'ROLE_NOT_CONFIGURED' ? 'resource-worker 未配置。' : code === 'MODEL_RESPONSE_INVALID' ? 'Worker 返回内容不符合结构化契约。' : '结构化 Worker 请求失败。'; }
function safeTurnErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{1,63}$/u.test(error.message)) return error.message;
  return 'TURN_FAILED';
}
function safeCode(code: string): string { return /^[A-Z][A-Z0-9_]{1,63}$/u.test(code) ? code : 'TOOL_FAILED'; }

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Server } from 'node:http';
import { open, unlink } from 'node:fs/promises';
import type { ChatSession } from './core/session.js';
import type { SessionStore, StoredSession } from './session-store.js';
import type { CapabilitySnapshot } from './capabilities.js';

export interface ResidentHostOptions {
  readonly host?: string;
  readonly port?: number;
  readonly token?: string;
  readonly provider: string;
  readonly model: string;
  readonly sessionStore: SessionStore;
  readonly createSession: (stored: StoredSession) => ChatSession;
  readonly capabilitySnapshot?: () => CapabilitySnapshot;
  readonly maxActiveTurns?: number;
  readonly lockPath?: string;
}

export class ResidentHost {
  readonly token: string;
  private readonly host: string;
  private readonly port: number;
  private readonly maxActiveTurns: number;
  private readonly active = new Map<string, ChatSession>();
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
    for (const session of this.active.values()) session.cancelActiveTurn({ kind: 'shutdown' });
    await Promise.all([...this.active.values()].map(session => session.whenIdle()));
    this.active.clear();
    if (this.server) await new Promise<void>(resolve => this.server!.close(() => resolve()));
    this.server = undefined;
    await this.lockHandle?.close().catch(() => undefined);
    this.lockHandle = undefined;
    if (this.options.lockPath) await unlink(this.options.lockPath).catch(() => undefined);
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('content-type', 'application/json; charset=utf-8');
    if (request.method === 'GET' && request.url === '/health') { this.send(response, 200, { ok: true, ready: Boolean(this.server), active: this.active.size }); return; }
    if (!this.authorized(request)) { this.send(response, 401, { error: 'UNAUTHORIZED' }); return; }
    try {
      const url = new URL(request.url ?? '/', `http://${this.host}`);
      if (request.method === 'GET' && url.pathname === '/capabilities') { this.send(response, 200, this.options.capabilitySnapshot?.() ?? { version: 1, hash: '', entries: [] }); return; }
      if (request.method === 'GET' && url.pathname === '/sessions') { this.send(response, 200, { sessions: await this.list() }); return; }
      if (request.method === 'POST' && url.pathname === '/sessions') { const body = await readJson(request); const session = await this.options.sessionStore.create(this.options.provider, this.options.model, typeof body.prompt === 'string' ? [{ role: 'user', content: body.prompt }] : []); this.send(response, 201, { sessionId: session.id }); return; }
      const match = url.pathname.match(/^\/sessions\/([^/]+)(?:\/(prompt|cancel|events))?$/);
      if (!match) { this.send(response, 404, { error: 'NOT_FOUND' }); return; }
      const session = await this.find(match[1]!);
      if (!session) { this.send(response, 404, { error: 'SESSION_NOT_FOUND' }); return; }
      if (request.method === 'GET' && !match[2]) { this.send(response, 200, safeSession(session)); return; }
      if (request.method === 'GET' && match[2] === 'events') { response.statusCode = 200; response.setHeader('content-type', 'text/event-stream; charset=utf-8'); response.setHeader('cache-control', 'no-cache'); response.setHeader('connection', 'keep-alive'); response.write(`event: session\ndata: ${JSON.stringify(safeSession(session))}\n\n`); response.end(); return; }
      if (request.method === 'POST' && match[2] === 'cancel') { const active = this.active.get(session.id); this.send(response, 200, { accepted: active?.cancelActiveTurn({ kind: 'user' }) ?? false }); return; }
      if (request.method === 'POST' && match[2] === 'prompt') { await this.prompt(session, await readJson(request), response); return; }
      this.send(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    } catch (error) { this.send(response, 400, { error: error instanceof Error ? error.message : 'HOST_REQUEST_FAILED' }); }
  }

  private async prompt(stored: StoredSession, body: Record<string, unknown>, response: ServerResponse): Promise<void> {
    if (typeof body.text !== 'string' || !body.text.trim()) { this.send(response, 400, { error: 'PROMPT_REQUIRED' }); return; }
    if (this.active.size >= this.maxActiveTurns) { this.send(response, 429, { error: 'HOST_BUSY' }); return; }
    const session = this.options.createSession(stored);
    this.active.set(stored.id, session);
    try { const result = await session.send(body.text); this.send(response, 200, { sessionId: stored.id, text: result.text, outcome: result.outcome }); }
    finally { this.active.delete(stored.id); }
  }

  private async list(): Promise<readonly object[]> { const sessions = this.options.sessionStore.listAll ? await this.options.sessionStore.listAll() : await this.options.sessionStore.list(this.options.provider, this.options.model); return sessions.filter(item => item.provider === this.options.provider && item.model === this.options.model).map(safeSession); }
  private async find(id: string): Promise<StoredSession | undefined> { const sessions = this.options.sessionStore.listAll ? await this.options.sessionStore.listAll() : await this.options.sessionStore.list(this.options.provider, this.options.model); return sessions.find(item => item.id === id && item.provider === this.options.provider && item.model === this.options.model); }
  private authorized(request: IncomingMessage): boolean { const value = request.headers.authorization; if (!value?.startsWith('Bearer ')) return false; const provided = Buffer.from(value.slice(7)); const expected = Buffer.from(this.token); return provided.length === expected.length && timingSafeEqual(provided, expected); }
  private send(response: ServerResponse, status: number, body: unknown): void { response.statusCode = status; response.end(JSON.stringify(body)); }
}

function isLoopback(host: string): boolean { return host === '127.0.0.1' || host === '::1' || host === 'localhost'; }
function safeSession(session: StoredSession): { readonly sessionId: string; readonly provider: string; readonly model: string; readonly updatedAt: string } { return { sessionId: session.id, provider: session.provider, model: session.model, updatedAt: session.updatedAt }; }
async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> { let text = ''; for await (const chunk of request) text += chunk.toString(); const value = JSON.parse(text || '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_JSON'); return value as Record<string, unknown>; }

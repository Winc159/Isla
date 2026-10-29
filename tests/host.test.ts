import { afterEach, describe, expect, it } from 'vitest';
import { ResidentHost } from '../src/host/server.js';
import { ResidentHostClient } from '../src/client/host-client.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { SessionStore, StoredSession } from '../src/sessions/store.js';
import type { HostTurnObservers } from '../src/host/server.js';
import { RuntimeError } from '../src/core/errors.js';

const sessions: StoredSession[] = [];
const store: SessionStore = {
  list: async () => sessions,
  listAll: async () => sessions,
  setArchived: async (sessionId, archived) => {
    const index = sessions.findIndex(session => session.id === sessionId);
    if (index < 0) return undefined;
    const current = sessions[index]!;
    const next = { ...current, version: 7 as const, ...(archived ? { archivedAt: ('archivedAt' in current && current.archivedAt) || new Date().toISOString() } : {}) } as StoredSession;
    if (!archived) delete (next as { archivedAt?: string }).archivedAt;
    sessions[index] = next;
    return next;
  },
  loadLatest: async () => sessions[0],
  create: async (_provider, model, messages, currentWorkspaceKey) => { const now = new Date().toISOString(); const session = { version: 5 as const, id: `s-${sessions.length + 1}`, createdAt: now, updatedAt: now, provider: 'fake', model, workspaceKey: currentWorkspaceKey ?? 'workspace', messages, journal: { version: 1 as const, turns: [] }, skillCatalog: { version: 1 as const, entries: [] } }; sessions.push(session); return session; },
  save: async (session) => session,
};
let host: ResidentHost | undefined;
afterEach(async () => { await host?.close(); host = undefined; sessions.length = 0; });

describe('resident host', () => {
  it('binds loopback and protects private API with bearer token', async () => {
    host = new ResidentHost({ host: '127.0.0.1', port: 0, token: 'test-token', provider: 'fake', model: 'm', sessionStore: store, createSession: () => ({ send: async text => ({ text: `echo:${text}` }), cancelActiveTurn: () => true, whenIdle: async () => {} } as never) });
    const address = await host.start();
    const health = await fetch(`http://${address.host}:${address.port}/health`);
    expect(health.status).toBe(200);
    expect((await fetch(`http://${address.host}:${address.port}/sessions`)).status).toBe(401);
    const key = (await import('../src/sessions/workspace.js')).workspaceKey(process.cwd());
    const created = await fetch(`http://${address.host}:${address.port}/sessions`, { method: 'POST', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' }, body: JSON.stringify({ workspaceKey: key }) });
    expect(created.status).toBe(201);
    const listed = await fetch(`http://${address.host}:${address.port}/sessions`, { headers: { authorization: 'Bearer test-token' } });
    expect((await listed.json() as { sessions: unknown[] }).sessions).toHaveLength(1);
    const events = await fetch(`http://${address.host}:${address.port}/sessions/s-1/events`, { headers: { authorization: 'Bearer test-token' } });
    expect(events.headers.get('content-type')).toContain('text/event-stream');
    expect(await events.text()).toContain('event: session');
  });

  it('rejects non-loopback binding', () => expect(() => new ResidentHost({ host: '0.0.0.0', provider: 'fake', model: 'm', sessionStore: store, createSession: () => ({}) as never })).toThrow('HOST_LOOPBACK_REQUIRED'));

  it('searches session messages and archives/restores through the host API', async () => {
    host = new ResidentHost({ host: '127.0.0.1', port: 0, token: 'session-token', provider: 'fake', model: 'm', sessionStore: store, createSession: () => ({}) as never });
    const address = await host.start();
    const headers = { authorization: 'Bearer session-token', 'content-type': 'application/json' };
    const key = (await import('../src/sessions/workspace.js')).workspaceKey(process.cwd());
    const created = await fetch(`http://${address.host}:${address.port}/sessions`, { method: 'POST', headers, body: JSON.stringify({ workspaceKey: key }) });
    const { sessionId } = await created.json() as { sessionId: string };
    const storedIndex = sessions.findIndex(session => session.id === sessionId);
    sessions[storedIndex] = { ...sessions[storedIndex]!, messages: [{ role: 'user', content: 'Find the hidden parser regression' }] } as StoredSession;

    const search = await fetch(`http://${address.host}:${address.port}/sessions?workspaceKey=${key}&q=parser`, { headers });
    expect(await search.json()).toMatchObject({ sessions: [{ sessionId, match: expect.stringContaining('parser') }] });
    const archived = await fetch(`http://${address.host}:${address.port}/sessions/${sessionId}/archive`, { method: 'POST', headers, body: JSON.stringify({ archived: true }) });
    expect(archived.status).toBe(200);
    expect(await (await fetch(`http://${address.host}:${address.port}/sessions?workspaceKey=${key}`, { headers })).json()).toMatchObject({ sessions: [] });
    expect(await (await fetch(`http://${address.host}:${address.port}/sessions?workspaceKey=${key}&archived=true`, { headers })).json()).toMatchObject({ sessions: [{ sessionId, archivedAt: expect.any(String) }] });
    const blockedTurn = await fetch(`http://${address.host}:${address.port}/sessions/${sessionId}/turns`, { method: 'POST', headers, body: JSON.stringify({ text: 'continue', workspaceRoot: process.cwd() }) });
    expect(blockedTurn.status).toBe(409);
    expect(await blockedTurn.json()).toMatchObject({ error: 'SESSION_ARCHIVED' });
    const restored = await fetch(`http://${address.host}:${address.port}/sessions/${sessionId}/archive`, { method: 'POST', headers, body: JSON.stringify({ archived: false }) });
    expect(restored.status).toBe(200);
  });

  it('queues follow-up prompts in order with request-id deduplication and separate turns', async () => {
    let releaseFirst!: () => void;
    const firstTurnGate = new Promise<void>(resolve => { releaseFirst = resolve; });
    const prompts: string[] = [];
    host = new ResidentHost({
      host: '127.0.0.1', port: 0, token: 'follow-up-token', provider: 'fake', model: 'm', sessionStore: store,
      createSession: () => ({
        send: async text => { prompts.push(text); if (prompts.length === 1) await firstTurnGate; return { text: `done:${text}` }; },
        cancelActiveTurn: () => true,
        whenIdle: async () => {},
      } as never),
    });
    const address = await host.start();
    const headers = { authorization: 'Bearer follow-up-token', 'content-type': 'application/json' };
    const key = (await import('../src/sessions/workspace.js')).workspaceKey(process.cwd());
    const created = await fetch(`http://${address.host}:${address.port}/sessions`, { method: 'POST', headers, body: JSON.stringify({ workspaceKey: key }) });
    const { sessionId } = await created.json() as { sessionId: string };
    const started = await fetch(`http://${address.host}:${address.port}/sessions/${sessionId}/turns`, { method: 'POST', headers, body: JSON.stringify({ text: 'first objective', workspaceRoot: process.cwd() }) });
    expect(started.status).toBe(202);
    const active = await fetch(`http://${address.host}:${address.port}/sessions/${sessionId}/turns/active`, { headers }).then(response => response.json()) as { turnId: string };
    const id = '00000000-0000-4000-8000-000000000001';
    const path = `http://${address.host}:${address.port}/sessions/${sessionId}/turns/${active.turnId}/follow-up`;
    const queued = await fetch(path, { method: 'POST', headers, body: JSON.stringify({ id, text: 'second objective' }) });
    expect(queued.status).toBe(202);
    expect(await queued.json()).toMatchObject({ accepted: true, duplicate: false, queuePosition: 1 });
    const retried = await fetch(path, { method: 'POST', headers, body: JSON.stringify({ id, text: 'second objective' }) });
    expect(await retried.json()).toMatchObject({ accepted: true, duplicate: true, queuePosition: 1 });
    releaseFirst();
    for (let attempt = 0; attempt < 100 && prompts.length < 2; attempt += 1) await new Promise(resolve => setTimeout(resolve, 10));
    expect(prompts).toEqual(['first objective', 'second objective']);
    const next = await fetch(`http://${address.host}:${address.port}/sessions/${sessionId}/turns/active`, { headers }).then(response => response.json()) as { turnId: string };
    expect(next.turnId).not.toBe(active.turnId);
    const events = await fetch(`http://${address.host}:${address.port}/sessions/${sessionId}/turns/${next.turnId}/events?after=0`, { headers }).then(response => response.json()) as { events: Array<{ event: { type: string; followUpId?: string } }> };
    expect(events.events.map(item => item.event)).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'turn_start', followUpId: id }), expect.objectContaining({ type: 'turn_completed' })]));
  });

  it('exposes cursor-based process output only within the owning workspace and session', async () => {
    host = new ResidentHost({
      host: '127.0.0.1', port: 0, token: 'process-view-token', provider: 'fake', model: 'm', sessionStore: store,
      executionProcesses: {
        list: ownerId => ownerId === 's-1' ? [{ processId: 'process-1', state: 'exited', executable: 'node', argv: ['--private-argument'], workdir: process.cwd(), startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), exitCode: 0, outputCursor: 1, tty: false, adapter: 'local', elapsedMs: 5, outputBytes: 12 }] : [],
        read: (id, afterCursor, _limitBytes, ownerId) => id === 'process-1' && ownerId === 's-1' ? { events: [{ sequence: 1, stream: 'stdout' as const, text: 'tests passed\n' }].filter(event => event.sequence > afterCursor), cursor: 1, truncated: false } : (() => { throw new Error('PROCESS_NOT_FOUND'); })(),
      } as never,
      createSession: () => ({}) as never,
    });
    const address = await host.start();
    const headers = { authorization: 'Bearer process-view-token', 'content-type': 'application/json' };
    const key = (await import('../src/sessions/workspace.js')).workspaceKey(process.cwd());
    await fetch(`http://${address.host}:${address.port}/sessions`, { method: 'POST', headers, body: JSON.stringify({ workspaceKey: key }) });
    const list = await fetch(`http://${address.host}:${address.port}/sessions/s-1/processes?workspaceRoot=${encodeURIComponent(process.cwd())}`, { headers });
    const listText = await list.text();
    expect(JSON.parse(listText)).toMatchObject({ processes: [{ processId: 'process-1', state: 'exited', workdir: '.', outputCursor: 1 }] });
    expect(listText).not.toContain('--private-argument');
    const output = await fetch(`http://${address.host}:${address.port}/sessions/s-1/processes/process-1/output?workspaceRoot=${encodeURIComponent(process.cwd())}&after=0`, { headers });
    expect(await output.json()).toMatchObject({ events: [{ sequence: 1, text: 'tests passed\n' }], cursor: 1, truncated: false });
    const wrongWorkspace = await fetch(`http://${address.host}:${address.port}/sessions/s-1/processes?workspaceRoot=${encodeURIComponent(tmpdir())}`, { headers });
    expect(wrongWorkspace.status).toBe(400);
  });

  it('supports the client facade and single-instance lock', async () => {
    const lockPath = join(tmpdir(), `isla-host-${randomUUID()}.lock`);
    host = new ResidentHost({ host: '127.0.0.1', port: 0, token: 'client-token', lockPath, provider: 'fake', model: 'm', sessionStore: store, createSession: () => ({ send: async text => ({ text }), cancelActiveTurn: () => true, whenIdle: async () => {} } as never) });
    const address = await host.start();
    await expect(new ResidentHost({ host: '127.0.0.1', port: 0, token: 'other', lockPath, provider: 'fake', model: 'm', sessionStore: store, createSession: () => ({}) as never }).start()).rejects.toThrow('HOST_ALREADY_RUNNING');
    const client = new ResidentHostClient(`http://${address.host}:${address.port}`, address.token);
    expect(await client.health()).toMatchObject({ ok: true });
    expect(await client.capabilities()).toMatchObject({ version: 1 });
  });

  it('serves the local UI and limits browser bootstrap to same-origin requests', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'isla-agent-ui-'));
    try {
      await writeFile(join(directory, 'index.html'), '<!doctype html><main>Isla UI</main>', 'utf8');
      host = new ResidentHost({ host: '127.0.0.1', port: 0, token: 'ui-secret', provider: 'fake', model: 'm', sessionStore: store, uiDirectory: directory, createSession: () => ({}) as never });
      const address = await host.start();
      const origin = `http://${address.host}:${address.port}`;
      const page = await fetch(origin);
      expect(page.status).toBe(200);
      expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
      expect(await page.text()).toContain('Isla UI');
      const bootstrap = await fetch(`${origin}/ui/bootstrap`, { headers: { 'sec-fetch-site': 'same-origin', origin } });
      expect(bootstrap.status).toBe(200);
      expect(bootstrap.headers.get('cache-control')).toBe('no-store');
      expect(await bootstrap.json()).toMatchObject({ token: 'ui-secret' });
      const crossOrigin = await fetch(`${origin}/ui/bootstrap`, { headers: { 'sec-fetch-site': 'same-site', origin: 'http://localhost:5173' } });
      expect(crossOrigin.status).toBe(403);
      expect((await fetch(`${origin}/sessions`)).status).toBe(401);
    } finally { await host?.close(); host = undefined; await rm(directory, { recursive: true, force: true }); }
  });

  it('keeps a web turn alive across client disconnect and supports event replay', async () => {
    let finish!: () => void;
    let observed: HostTurnObservers | undefined;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    host = new ResidentHost({ host: '127.0.0.1', port: 0, token: 'resume-token', provider: 'fake', model: 'm', sessionStore: store, createSession: (_stored, _root, events) => {
      observed = events;
      return { send: async text => { events!.onModelStepEvent({ type: 'model_delta', step: 1, attempt: 1, provisional: true, text: 'working' }); await waiting; return { text: `done:${text}` }; }, cancelActiveTurn: () => false, whenIdle: async () => {}, currentTurnPhase: 'model' } as never;
    } });
    const address = await host.start();
    const client = new ResidentHostClient(`http://${address.host}:${address.port}`, address.token);
    const root = process.cwd();
    const key = (await import('../src/sessions/workspace.js')).workspaceKey(root);
    const session = await store.create('fake', 'm', [], key);
    const turn = await client.beginTurn(session.id, 'complete this task', root);
    expect(turn).toMatchObject({ sessionId: session.id });
    for (let attempt = 0; attempt < 30 && !observed; attempt += 1) await new Promise(resolve => setTimeout(resolve, 5));
    expect(observed).toBeDefined();
    const active = await client.activeTurn(session.id);
    expect(active).toMatchObject({ active: true, turnId: turn.turnId });
    const replay = await client.turnEvents(session.id, turn.turnId);
    expect(replay.events.map(item => item.event.type)).toContain('model_delta');
    finish();
    let result = await client.turnEvents(session.id, turn.turnId, replay.nextSequence);
    for (let attempt = 0; attempt < 30 && result.active; attempt += 1) { await new Promise(resolve => setTimeout(resolve, 5)); result = await client.turnEvents(session.id, turn.turnId, replay.nextSequence); }
    expect(result.active).toBe(false);
    expect(result.events.some(item => item.event.type === 'turn_completed')).toBe(true);
  });

  it('preserves safe RuntimeError codes in failed turn events', async () => {
    host = new ResidentHost({ host: '127.0.0.1', port: 0, token: 'failure-code-token', provider: 'fake', model: 'm', sessionStore: store, createSession: () => ({
      send: async () => { throw new RuntimeError({ code: 'PROVIDER_RATE_LIMIT', recoverable: true, message: '模型服务请求过于频繁。' }); },
      cancelActiveTurn: () => false,
      whenIdle: async () => {},
    } as never) });
    const address = await host.start();
    const client = new ResidentHostClient(`http://${address.host}:${address.port}`, address.token);
    const root = process.cwd();
    const key = (await import('../src/sessions/workspace.js')).workspaceKey(root);
    const session = await store.create('fake', 'm', [], key);
    const turn = await client.beginTurn(session.id, 'test provider failure reporting', root);
    let result = await client.turnEvents(session.id, turn.turnId);
    for (let attempt = 0; attempt < 30 && result.active; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5));
      result = await client.turnEvents(session.id, turn.turnId);
    }
    expect(result.events.map(item => item.event)).toContainEqual(expect.objectContaining({ type: 'turn_failed', code: 'PROVIDER_RATE_LIMIT' }));
  });

  it('serves the same turn event history to multiple clients without repeating execution', async () => {
    let finish!: () => void;
    let observed: HostTurnObservers | undefined;
    let sendCount = 0;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    host = new ResidentHost({ host: '127.0.0.1', port: 0, token: 'multi-client-token', provider: 'fake', model: 'm', sessionStore: store, createSession: (_stored, _root, events) => {
      observed = events;
      return { send: async text => { sendCount += 1; events!.onModelStepEvent({ type: 'model_delta', step: 1, attempt: 1, provisional: true, text: 'shared answer' }); await waiting; return { text: `done:${text}` }; }, cancelActiveTurn: () => false, whenIdle: async () => {}, currentTurnPhase: 'model' } as never;
    } });
    const address = await host.start();
    const firstClient = new ResidentHostClient(`http://${address.host}:${address.port}`, address.token);
    const secondClient = new ResidentHostClient(`http://${address.host}:${address.port}`, address.token);
    const root = process.cwd();
    const key = (await import('../src/sessions/workspace.js')).workspaceKey(root);
    const session = await store.create('fake', 'm', [], key);
    const turn = await firstClient.beginTurn(session.id, 'one shared objective', root);
    for (let attempt = 0; attempt < 30 && !observed; attempt += 1) await new Promise(resolve => setTimeout(resolve, 5));
    expect(observed).toBeDefined();
    const [firstReplay, secondReplay] = await Promise.all([
      firstClient.turnEvents(session.id, turn.turnId),
      secondClient.turnEvents(session.id, turn.turnId),
    ]);
    expect(firstReplay.events).toEqual(secondReplay.events);
    expect(firstReplay.events.map(item => item.event.type)).toContain('model_delta');
    expect(sendCount).toBe(1);

    finish();
    const terminalEvents = async (client: ResidentHostClient) => {
      let result = await client.turnEvents(session.id, turn.turnId, firstReplay.nextSequence);
      for (let attempt = 0; attempt < 30 && result.active; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 5));
        result = await client.turnEvents(session.id, turn.turnId, firstReplay.nextSequence);
      }
      return result;
    };
    const [firstTerminal, secondTerminal] = await Promise.all([terminalEvents(firstClient), terminalEvents(secondClient)]);
    expect(firstTerminal.events).toEqual(secondTerminal.events);
    expect(firstTerminal.events.map(item => item.event.type)).toContain('turn_completed');
    expect(sendCount).toBe(1);
  });

  it('resumes the latest workspace session for quick prompts and supports --new semantics', async () => {
    host = new ResidentHost({ host: '127.0.0.1', port: 0, token: 'client-token', provider: 'fake', model: 'm', sessionStore: store, createSession: stored => ({ send: async text => ({ text: `${stored.id}:${text}` }), cancelActiveTurn: () => true, whenIdle: async () => {} } as never) });
    const address = await host.start();
    const client = new ResidentHostClient(`http://${address.host}:${address.port}`, address.token);
    const root = process.cwd();
    const key = (await import('../src/sessions/workspace.js')).workspaceKey(root);
    expect(await client.quickPrompt('one', key, root)).toMatchObject({ sessionId: 's-1', text: 's-1:one' });
    expect(await client.quickPrompt('two', key, root)).toMatchObject({ sessionId: 's-1', text: 's-1:two' });
    expect(await client.quickPrompt('three', key, root, true)).toMatchObject({ sessionId: 's-2', text: 's-2:three' });
  });

  it('streams quick turn events and rejects stale cancellation identities', async () => {
    let observer: HostTurnObservers | undefined;
    let phase: 'model' | 'cancelled' = 'model';
    let reject!: (error: Error) => void;
    host = new ResidentHost({ host: '127.0.0.1', port: 0, token: 'stream-token', provider: 'fake', model: 'm', sessionStore: store, createSession: (_stored, _root, events) => {
      observer = events;
      return {
        send: () => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }),
        cancelActiveTurn: () => { phase = 'cancelled'; reject(new Error('TURN_CANCELLED')); return true; },
        whenIdle: async () => {},
        get currentTurnPhase() { return phase; },
      } as never;
    } });
    const address = await host.start();
    const root = process.cwd();
    const key = (await import('../src/sessions/workspace.js')).workspaceKey(root);
    const response = await fetch(`http://${address.host}:${address.port}/quick`, { method: 'POST', headers: { authorization: 'Bearer stream-token', accept: 'application/x-ndjson', 'content-type': 'application/json' }, body: JSON.stringify({ text: 'stream me', workspaceKey: key, workspaceRoot: root }) });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let first = decoder.decode((await reader.read()).value);
    while (!first.includes('\n')) first += decoder.decode((await reader.read()).value);
    const start = JSON.parse(first.trim().split('\n')[0]!) as { sessionId: string; turnId: string; type: string };
    expect(start.type).toBe('turn_start');
    expect(observer?.approvalService).toBeUndefined();
    observer!.onModelStepEvent({ type: 'model_delta', step: 1, attempt: 1, provisional: true, text: 'partial' });
    const stale = await fetch(`http://${address.host}:${address.port}/sessions/${start.sessionId}/cancel`, { method: 'POST', headers: { authorization: 'Bearer stream-token', 'content-type': 'application/json' }, body: JSON.stringify({ turnId: 'old-turn' }) });
    expect(await stale.json()).toEqual({ accepted: false });
    const accepted = await fetch(`http://${address.host}:${address.port}/sessions/${start.sessionId}/cancel`, { method: 'POST', headers: { authorization: 'Bearer stream-token', 'content-type': 'application/json' }, body: JSON.stringify({ turnId: start.turnId }) });
    expect(await accepted.json()).toEqual({ accepted: true });
    let rest = decoder.decode((await reader.read()).value);
    while (!rest.includes('turn_cancelled')) rest += decoder.decode((await reader.read()).value);
    await reader.cancel();
    expect(rest).toContain('"type":"model_delta"');
    expect(rest).toContain('"type":"turn_cancelled"');
  });

  it('bridges remote approval with exact interaction and turn identity', async () => {
    let observer: HostTurnObservers | undefined;
    host = new ResidentHost({ host: '127.0.0.1', port: 0, token: 'approval-token', provider: 'fake', model: 'm', sessionStore: store, createSession: (_stored, _root, events) => {
      observer = events;
      return { send: async () => { const value = await events!.approvalService!.request({ toolName: 'file.write', permission: { kind: 'filesystem-write' }, summary: 'Write report to C:\\Users\\private\\report.txt' }); if (!value.approved) throw new Error('TURN_FAILED'); return { text: 'approved' }; }, cancelActiveTurn: () => true, whenIdle: async () => {} } as never;
    } });
    const address = await host.start();
    const root = process.cwd(); const key = (await import('../src/sessions/workspace.js')).workspaceKey(root);
    const created = await fetch(`http://${address.host}:${address.port}/sessions`, { method: 'POST', headers: { authorization: 'Bearer approval-token', 'content-type': 'application/json' }, body: JSON.stringify({ workspaceKey: key }) });
    const { sessionId } = await created.json() as { sessionId: string };
    const responsePromise = fetch(`http://${address.host}:${address.port}/sessions/${sessionId}/prompt`, { method: 'POST', headers: { authorization: 'Bearer approval-token', 'content-type': 'application/json', accept: 'application/x-ndjson' }, body: JSON.stringify({ text: 'run', workspaceRoot: root }) });
    const response = await responsePromise;
    const reader = response.body!.getReader(); const decoder = new TextDecoder(); let output = '';
    while (!output.includes('approval_requested')) output += decoder.decode((await reader.read()).value);
    const eventLine = output.split('\n').find(line => line.includes('approval_requested'))!;
    const event = JSON.parse(eventLine) as { approvalId: string; turnId?: string; type: string };
    expect(output).not.toContain('C:\\Users\\private');
    expect(event.type).toBe('approval_requested');
    const start = JSON.parse(output.split('\n').find(line => line.includes('turn_start'))!) as { turnId: string };
    const stale = await fetch(`http://${address.host}:${address.port}/sessions/${sessionId}/interactions/${event.approvalId}`, { method: 'POST', headers: { authorization: 'Bearer approval-token', 'content-type': 'application/json' }, body: JSON.stringify({ turnId: 'stale', approved: true }) });
    expect(stale.status).toBe(409);
    const approvalUrl = `http://${address.host}:${address.port}/sessions/${sessionId}/interactions/${event.approvalId}`;
    const responses = await Promise.all([true, false].map(approved => fetch(approvalUrl, { method: 'POST', headers: { authorization: 'Bearer approval-token', 'content-type': 'application/json' }, body: JSON.stringify({ turnId: start.turnId, approved }) })));
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    let rest = '';
    while (!rest.includes('turn_completed')) rest += decoder.decode((await reader.read()).value);
    expect(rest).toContain('"text":"approved"');
    expect(rest).toContain('"type":"turn_completed"');
    expect(observer).toBeDefined();
    await reader.cancel();
  });

  it('bridges remote user questions and rejects responses for another turn', async () => {
    host = new ResidentHost({ host: '127.0.0.1', port: 0, token: 'question-token', provider: 'fake', model: 'm', sessionStore: store, createSession: (_stored, _root, events) => ({
      send: async () => { const result = await events!.userQuestionService!.ask({ questions: [{ id: 'choice', question: '继续吗？', options: [{ label: '继续' }, { label: '停止' }] }] }); return { text: result.answers[0]?.custom ?? 'answered' }; },
      cancelActiveTurn: () => true, whenIdle: async () => {},
    } as never) });
    const address = await host.start(); const root = process.cwd(); const key = (await import('../src/sessions/workspace.js')).workspaceKey(root);
    const created = await fetch(`http://${address.host}:${address.port}/sessions`, { method: 'POST', headers: { authorization: 'Bearer question-token', 'content-type': 'application/json' }, body: JSON.stringify({ workspaceKey: key }) });
    const { sessionId } = await created.json() as { sessionId: string };
    const response = await fetch(`http://${address.host}:${address.port}/sessions/${sessionId}/prompt`, { method: 'POST', headers: { authorization: 'Bearer question-token', 'content-type': 'application/json', accept: 'application/x-ndjson' }, body: JSON.stringify({ text: 'ask', workspaceRoot: root }) });
    const reader = response.body!.getReader(); const decoder = new TextDecoder(); let output = '';
    while (!output.includes('question_requested')) output += decoder.decode((await reader.read()).value);
    const lines = output.split('\n'); const event = JSON.parse(lines.find(line => line.includes('question_requested'))!) as { questionId: string; type: string };
    const start = JSON.parse(lines.find(line => line.includes('turn_start'))!) as { turnId: string };
    const stale = await fetch(`http://${address.host}:${address.port}/sessions/${sessionId}/interactions/${event.questionId}`, { method: 'POST', headers: { authorization: 'Bearer question-token', 'content-type': 'application/json' }, body: JSON.stringify({ turnId: 'another-turn', answers: [{ id: 'choice', selected: [], custom: 'yes' }] }) });
    expect(stale.status).toBe(409);
    const accepted = await fetch(`http://${address.host}:${address.port}/sessions/${sessionId}/interactions/${event.questionId}`, { method: 'POST', headers: { authorization: 'Bearer question-token', 'content-type': 'application/json' }, body: JSON.stringify({ turnId: start.turnId, answers: [{ id: 'choice', selected: [], custom: 'yes' }] }) });
    expect(accepted.status).toBe(200);
    let rest = '';
    while (!rest.includes('turn_completed')) rest += decoder.decode((await reader.read()).value);
    expect(rest).toContain('"text":"yes"'); await reader.cancel();
  });
});

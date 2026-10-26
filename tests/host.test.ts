import { afterEach, describe, expect, it } from 'vitest';
import { ResidentHost } from '../src/host/server.js';
import { ResidentHostClient } from '../src/client/host-client.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { SessionStore, StoredSession } from '../src/sessions/store.js';
import type { HostTurnObservers } from '../src/host/server.js';

const sessions: StoredSession[] = [];
const store: SessionStore = {
  list: async () => sessions,
  listAll: async () => sessions,
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

  it('supports the client facade and single-instance lock', async () => {
    const lockPath = join(tmpdir(), `isla-host-${randomUUID()}.lock`);
    host = new ResidentHost({ host: '127.0.0.1', port: 0, token: 'client-token', lockPath, provider: 'fake', model: 'm', sessionStore: store, createSession: () => ({ send: async text => ({ text }), cancelActiveTurn: () => true, whenIdle: async () => {} } as never) });
    const address = await host.start();
    await expect(new ResidentHost({ host: '127.0.0.1', port: 0, token: 'other', lockPath, provider: 'fake', model: 'm', sessionStore: store, createSession: () => ({}) as never }).start()).rejects.toThrow('HOST_ALREADY_RUNNING');
    const client = new ResidentHostClient(`http://${address.host}:${address.port}`, address.token);
    expect(await client.health()).toMatchObject({ ok: true });
    expect(await client.capabilities()).toMatchObject({ version: 1 });
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
    const accepted = await fetch(`http://${address.host}:${address.port}/sessions/${sessionId}/interactions/${event.approvalId}`, { method: 'POST', headers: { authorization: 'Bearer approval-token', 'content-type': 'application/json' }, body: JSON.stringify({ turnId: start.turnId, approved: false }) });
    expect(accepted.status).toBe(200);
    void observer;
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

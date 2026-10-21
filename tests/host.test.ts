import { afterEach, describe, expect, it } from 'vitest';
import { ResidentHost } from '../src/host/server.js';
import { ResidentHostClient } from '../src/client/host-client.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { SessionStore, StoredSession } from '../src/sessions/store.js';

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
    const created = await fetch(`http://${address.host}:${address.port}/sessions`, { method: 'POST', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' }, body: '{}' });
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
});

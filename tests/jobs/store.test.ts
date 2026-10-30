import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JobStore } from '../../src/jobs/store.js';
import { JobRuntime } from '../../src/jobs/runtime.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function store(): Promise<{ readonly root: string; readonly store: JobStore }> { const root = await mkdtemp(join(tmpdir(), 'isla-jobs-')); roots.push(root); return { root, store: new JobStore(join(root, 'jobs.sqlite')) }; }

describe('JobStore', () => {
  it('creates idempotently for the same owner and key', async () => {
    const { store: jobs } = await store();
    const input = { type: 'research', owner: { kind: 'session' as const, id: 'session-1' }, idempotencyKey: 'request-1', inputRef: 'payload://one' };
    const first = jobs.create(input); const duplicate = jobs.create({ ...input, inputRef: 'payload://different' });
    expect(duplicate.id).toBe(first.id); expect(jobs.list()).toHaveLength(1); jobs.close();
  });

  it('claims with a lease, rejects another live owner, and recovers an expired lease after reopen', async () => {
    const { root, store: first } = await store(); const job = first.create({ type: 'research', owner: { kind: 'session', id: 's' }, inputRef: 'payload://x' });
    expect(first.claim(job.id, 'worker-a', 1000, 1000)?.ownerId).toBe('worker-a');
    expect(first.claim(job.id, 'worker-b', 1000, 1500)).toBeUndefined();
    first.close(); const reopened = new JobStore(join(root, 'jobs.sqlite'));
    expect(reopened.recoverExpired(2500)).toBe(1); expect(reopened.get(job.id)?.status).toBe('queued');
    expect(reopened.events(job.id).map(event => event.type)).toContain('job.recovered'); reopened.close();
  });

  it('enforces waiting_user, terminal uniqueness and bounded child depth', async () => {
    const { store: jobs } = await store(); const job = jobs.create({ type: 'research', owner: { kind: 'session', id: 's' }, inputRef: 'payload://x' });
    jobs.claim(job.id, 'worker', 10_000);
    const waiting = jobs.update(job.id, 'worker', 'waiting_user', { waitingUser: { prompt: 'choose', since: new Date().toISOString() } });
    expect(waiting.status).toBe('waiting_user'); expect(waiting.waitingUser?.prompt).toBe('choose');
    expect(jobs.respond(job.id, 'continue').status).toBe('queued'); expect(jobs.payload(job.id)).toMatchObject({ userAnswer: 'continue' });
    jobs.claim(job.id, 'worker', 10_000);
    expect(jobs.cancel(job.id).job?.status).toBe('cancelled'); expect(jobs.cancel(job.id).accepted).toBe(false);
    expect(() => jobs.create({ type: 'research', owner: { kind: 'job', id: job.id }, inputRef: 'payload://child' })).toThrow('SUBAGENT_DEPTH_EXCEEDED'); jobs.close();
  });

  it('does not cancel persisted work when a client/session owner disappears', async () => {
    const { root, store: jobs } = await store(); const runtime = new JobRuntime(jobs); runtime.register('research', async () => await new Promise(resolve => setTimeout(() => resolve('done'), 10_000))); await runtime.start();
    const job = runtime.create({ type: 'research', owner: { kind: 'session', id: 'session-closed' }, inputRef: 'payload://x' });
    await new Promise(resolve => setTimeout(resolve, 20)); await runtime.close();
    const reopened = new JobStore(join(root, 'jobs.sqlite')); expect(reopened.get(job.id)?.status).toBe('queued'); reopened.close();
  });
});

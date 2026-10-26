import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileEventStore } from '../../src/core/event-store.js';

describe('FileEventStore', () => {
  it('appends monotonic events and resumes by cursor', async () => {
    const store = new FileEventStore(await mkdtemp(join(tmpdir(), 'isla-events-')));
    await Promise.all([store.append('s', { type: 'user', input: 'a' }), store.append('s', { type: 'assistant', text: 'b' })]);
    const all = await store.read('s'); expect(all.map(item => item.sequence)).toEqual([1, 2]); expect((await store.read('s', 1)).map(item => item.type)).toEqual(['message/assistant']);
  });
  it('truncates a torn tail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'isla-events-')); const store = new FileEventStore(root); await store.append('s', { type: 'user', input: 'a' });
    await writeFile(join(root, 's.jsonl'), `${JSON.stringify((await store.read('s'))[0])}\n{"broken":`, 'utf8');
    expect((await store.read('s')).length).toBe(1);
  });
});

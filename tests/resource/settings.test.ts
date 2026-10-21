import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResourceSettingsStore } from '../../src/resource/settings.js';

describe('Resource directory settings', () => {
  let root: string | undefined;
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  it('saves user directories with revision checking and no internal fields', async () => {
    root = await mkdtemp(join(tmpdir(), 'isla-resource-settings-'));
    const path = join(root, 'resource.json');
    await writeFile(path, JSON.stringify({ version: 1, managedRoots: [{ id: 'old', label: '旧目录', path: join(root, 'old'), scanEnabled: true, outputEnabled: true }], defaultDestinationRootId: 'old' }), 'utf8');
    const runtime = { version: 1 as const, host: { host: '127.0.0.1' as const, port: 43110, token: 'h'.repeat(64) }, resource: { host: '127.0.0.1' as const, port: 43111, token: 'r'.repeat(64) } };
    const store = new ResourceSettingsStore(path, runtime);
    const before = await store.read();
    const nextRoot = { id: 'library', label: '资源库', path: join(root, 'library'), scanEnabled: true, outputEnabled: true };
    const after = await store.update({ revision: before.revision, managedRoots: [nextRoot], defaultDestinationRootId: 'library' });
    expect(after.managedRoots).toEqual([nextRoot]);
    const source = await readFile(path, 'utf8');
    expect(source).not.toMatch(/token|databasePath|stagingPath|listen/u);
    await expect(store.update({ revision: before.revision, managedRoots: [nextRoot], defaultDestinationRootId: 'library' })).rejects.toThrow('REVISION_STALE');
  });
});

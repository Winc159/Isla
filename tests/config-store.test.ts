import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigStore } from '../src/config-store.js';
import type { IslaConfigFileV1 } from '../src/config.js';

const config: IslaConfigFileV1 = {
  version: 1,
  defaultProfile: 'main',
  profiles: { main: { provider: 'deepseek', model: 'deepseek-chat', apiKey: 'test-only-key' } },
};

describe('ConfigStore', () => {
  let root: string;
  let store: ConfigStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'isla-config-'));
    store = new ConfigStore(join(root, 'nested', 'config.json'));
  });

  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('classifies a missing file and saves a new config atomically', async () => {
    await expect(store.load()).resolves.toMatchObject({ status: 'missing' });
    const saved = await store.save(config);
    expect(saved.revision).toMatch(/^[0-9a-f]{64}$/);
    await expect(store.load()).resolves.toMatchObject({ status: 'ready', revision: saved.revision, config });
    expect(await readFile(store.path, 'utf8')).toContain('test-only-key');
  });

  it('classifies an empty valid config', async () => {
    await store.save({ version: 1, profiles: {} });
    await expect(store.load()).resolves.toMatchObject({ status: 'empty' });
  });

  it('classifies invalid JSON without replacing it', async () => {
    await mkdir(join(root, 'nested'), { recursive: true });
    await writeFile(store.path, '{', 'utf8');
    const loaded = await store.load();
    expect(loaded.status).toBe('invalid');
    expect(await readFile(store.path, 'utf8')).toBe('{');
  });

  it('rejects replacement without an expected revision and detects stale revisions', async () => {
    const first = await store.save(config);
    await expect(store.save(config)).rejects.toThrow('expected revision');
    await writeFile(store.path, JSON.stringify({ version: 1, profiles: {} }), 'utf8');
    await expect(store.save(config, first.revision)).rejects.toThrow('changed by another process');
  });

  it('cleans temporary files and preserves a valid original when validation fails', async () => {
    const first = await store.save(config);
    const invalid = { ...config, profiles: { main: { provider: 'deepseek', model: '', apiKey: 'test-only-key' } } } as unknown as IslaConfigFileV1;
    await expect(store.save(invalid, first.revision)).rejects.toThrow('model');
    expect((await store.load()).revision).toBe(first.revision);
    expect((await readdir(join(root, 'nested'))).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });
});

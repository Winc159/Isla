import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore } from '../../src/config/store.js';
import { ResourceWorkerSettings } from '../../src/resource/worker-settings.js';

describe('Resource Worker settings', () => {
  let root: string | undefined;
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  it('atomically enables a worker and never returns its API key', async () => {
    root = await mkdtemp(join(tmpdir(), 'isla-worker-settings-'));
    const store = new ConfigStore(join(root, 'config.json'));
    await store.save({ version: 1, defaultProfile: 'main', profiles: { main: { provider: 'deepseek', model: 'main', apiKey: 'primary-test-key' } } });
    const settings = new ResourceWorkerSettings(store, { endpoint: 'http://127.0.0.1:1', token: 'host-test-token' });
    const before = await settings.read();
    const after = await settings.update({ revision: before.revision, enabled: true, provider: 'openai', model: 'worker-model', apiKey: 'worker-test-key' });
    expect(after).toMatchObject({ enabled: true, provider: 'openai', model: 'worker-model', apiKeyConfigured: true, active: false });
    expect(JSON.stringify(after)).not.toContain('worker-test-key');
    const loaded = await store.load();
    expect(loaded).toMatchObject({ status: 'ready', config: { workerProfile: 'resource-worker', profiles: { main: { model: 'main' }, 'resource-worker': { model: 'worker-model' } } } });
  });

  it('preserves a saved key when replacing only provider settings and rejects stale writes', async () => {
    root = await mkdtemp(join(tmpdir(), 'isla-worker-settings-'));
    const store = new ConfigStore(join(root, 'config.json'));
    await store.save({ version: 1, profiles: { 'resource-worker': { provider: 'deepseek', model: 'old', apiKey: 'saved-test-key' } }, workerProfile: 'resource-worker' });
    const settings = new ResourceWorkerSettings(store, { endpoint: 'http://127.0.0.1:1', token: 'host-test-token' });
    const before = await settings.read();
    await settings.update({ revision: before.revision, enabled: true, provider: 'deepseek', model: 'new' });
    const loaded = await store.load();
    expect(loaded.status === 'ready' && loaded.config.profiles['resource-worker']).toMatchObject({ model: 'new', apiKey: 'saved-test-key' });
    await expect(settings.update({ revision: before.revision, enabled: false })).rejects.toThrow('CONFIG_REVISION_STALE');
  });
});

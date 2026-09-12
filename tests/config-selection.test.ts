import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadRuntime } from '../src/main.js';

describe('startup config selection', () => {
  let root: string;
  let configPath: string;

  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'isla-selection-')); configPath = join(root, 'config.json'); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('uses an explicit profile from a config file', async () => {
    await mkdir(root, { recursive: true });
    await writeFile(configPath, JSON.stringify({ version: 1, defaultProfile: 'main', profiles: { main: { provider: 'local', model: 'local-model', baseURL: 'http://localhost:11434/v1' } } }), 'utf8');
    const result = await loadRuntime(['--config', configPath, '--profile', 'main'], {});
    expect(result.config).toMatchObject({ provider: 'local', model: 'local-model', baseURL: 'http://localhost:11434/v1' });
  });

  it('uses explicit env mode and does not read a config file', async () => {
    const result = await loadRuntime(['--env'], { ISLA_PROVIDER: 'local', ISLA_MODEL: 'env-model', ISLA_BASE_URL: 'http://localhost:1234/v1' });
    expect(result.config).toMatchObject({ provider: 'local', model: 'env-model' });
  });

  it('falls back to complete environment configuration when the file is missing', async () => {
    const result = await loadRuntime(['--config', configPath], { ISLA_PROVIDER: 'local', ISLA_MODEL: 'env-model', ISLA_BASE_URL: 'http://localhost:1234/v1' });
    expect(result.config).toMatchObject({ provider: 'local', model: 'env-model' });
  });

  it('does not allow a missing config file to satisfy an explicit profile', async () => {
    await expect(loadRuntime(['--config', configPath, '--profile', 'missing'], { ISLA_PROVIDER: 'local', ISLA_MODEL: 'env-model', ISLA_BASE_URL: 'http://localhost:1234/v1' })).rejects.toThrow('unavailable');
  });

  it('rejects invalid existing config instead of falling back to environment variables', async () => {
    await mkdir(root, { recursive: true });
    await writeFile(configPath, '{', 'utf8');
    await expect(loadRuntime(['--config', configPath], { ISLA_PROVIDER: 'local', ISLA_MODEL: 'env-model', ISLA_BASE_URL: 'http://localhost:1234/v1' })).rejects.toThrow('Unable to load Isla config');
  });
});

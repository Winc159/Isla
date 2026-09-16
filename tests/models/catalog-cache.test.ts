import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { modelCatalogCacheIdentity, modelCatalogCachePath, readModelCatalogCache, writeModelCatalogCache } from '../../src/models/catalog-cache.js';

describe('model catalog cache', () => {
  it('writes and reads a safe cache atomically', async () => {
    const root = await mkdtemp(join(tmpdir(), 'isla-model-cache-'));
    try {
      const path = join(root, 'models.json');
      const identity = modelCatalogCacheIdentity('bailian', 'default', 'https://workspace.example/api/v1/models');
      await writeModelCatalogCache(path, [{ id: 'qwen-plus', capabilities: [], features: [] }], identity);
      expect(await readModelCatalogCache(path, identity)).toMatchObject({ models: [{ id: 'qwen-plus' }] });
      await expect(readModelCatalogCache(path, modelCatalogCacheIdentity('deepseek', 'default', 'https://api.deepseek.com/models'))).resolves.toBeUndefined();
      expect(await readFile(path, 'utf8')).not.toContain('Authorization');
      expect(await readFile(path, 'utf8')).not.toContain('workspace.example');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('derives a stable opaque path from provider, profile, and endpoint', () => {
    const first = modelCatalogCachePath('D:/config.json', 'bailian', 'default', 'https://workspace.example/api/v1/models');
    expect(first).toMatch(/^D:\/config\.json\.models-[a-f0-9]{64}\.json$/);
    expect(first).toBe(modelCatalogCachePath('D:/config.json', 'bailian', 'default', 'https://workspace.example/api/v1/models'));
    expect(first).not.toContain('workspace.example');
  });
});

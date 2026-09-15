import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readModelCatalogCache, writeModelCatalogCache } from '../../src/models/catalog-cache.js';

describe('model catalog cache', () => {
  it('writes and reads a safe cache atomically', async () => {
    const root = await mkdtemp(join(tmpdir(), 'isla-model-cache-'));
    try {
      const path = join(root, 'models.json');
      await writeModelCatalogCache(path, [{ id: 'qwen-plus', capabilities: [], features: [] }]);
      expect(await readModelCatalogCache(path)).toMatchObject({ models: [{ id: 'qwen-plus' }] });
      expect(await readFile(path, 'utf8')).not.toContain('Authorization');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

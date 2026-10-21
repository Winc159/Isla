import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrCreateLocalRuntimeConfig } from '../src/config/local-runtime.js';

describe('local runtime config', () => {
  let root: string | undefined;
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  it('creates stable loopback endpoints and private tokens', async () => {
    root = await mkdtemp(join(tmpdir(), 'isla-runtime-'));
    const path = join(root, 'nested', 'runtime.json');
    const first = await loadOrCreateLocalRuntimeConfig(path);
    const second = await loadOrCreateLocalRuntimeConfig(path);
    expect(second).toEqual(first);
    expect(first.host).toMatchObject({ host: '127.0.0.1', port: 43110 });
    expect(first.resource).toMatchObject({ host: '127.0.0.1', port: 43111 });
    expect(await readFile(path, 'utf8')).not.toContain('apiKey');
  });
});

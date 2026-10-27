import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PinnedResponse } from '../../src/web/transport.js';
import { downloadVerifiedArtifact } from '../../src/dependencies/download.js';

describe('verified dependency artifact download', () => {
  let directory: string | undefined;
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });

  it('pins a fixed HTTPS host, verifies the hash, and publishes the complete file', async () => {
    directory = await mkdtemp(join(tmpdir(), 'isla-dependency-download-'));
    const bytes = Buffer.from('trusted-artifact');
    let hostname = '';
    let closed = false;
    const targetPath = join(directory, 'artifact.tar.gz');
    const result = await downloadVerifiedArtifact({ source: 'https://artifacts.example.test/v1/file.tar.gz', sha256: sha(bytes), maxBytes: 1024, targetPath }, {
      resolveAddresses: async host => { hostname = host; return [{ address: '93.184.216.34', family: 4 }]; },
      requestPinned: async () => ({ response: new Response(bytes, { status: 200 }) as unknown as PinnedResponse['response'], close: async () => { closed = true; } }),
    });
    expect(result).toEqual({ bytes: bytes.length, sha256: sha(bytes) });
    expect(hostname).toBe('artifacts.example.test');
    expect(closed).toBe(true);
    await expect(readFile(targetPath)).resolves.toEqual(bytes);
  });

  it('rejects redirects, over-limit bodies, and mismatched hashes without partial files', async () => {
    directory = await mkdtemp(join(tmpdir(), 'isla-dependency-download-'));
    const targetPath = join(directory, 'artifact.tar.gz');
    const create = (response: Response) => downloadVerifiedArtifact({ source: 'https://artifacts.example.test/a', sha256: sha(Buffer.from('ok')), maxBytes: 2, targetPath }, {
      resolveAddresses: async () => [{ address: '93.184.216.34', family: 4 }],
      requestPinned: async () => ({ response: response as unknown as PinnedResponse['response'], close: async () => undefined }),
    });
    await expect(create(new Response('', { status: 302, headers: { location: 'https://other.test' } }))).rejects.toThrow('DEPENDENCY_REDIRECT_BLOCKED');
    await expect(create(new Response('toolong', { status: 200 }))).rejects.toThrow('DEPENDENCY_ARTIFACT_TOO_LARGE');
    await expect(create(new Response('no', { status: 200 }))).rejects.toThrow('DEPENDENCY_HASH_MISMATCH');
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it('rejects non-HTTPS sources before any request', async () => {
    directory = await mkdtemp(join(tmpdir(), 'isla-dependency-download-'));
    let requested = false;
    await expect(downloadVerifiedArtifact({ source: 'http://artifacts.example.test/a', sha256: '0'.repeat(64), maxBytes: 10, targetPath: join(directory, 'x') }, { requestPinned: async () => { requested = true; throw new Error('unexpected'); } })).rejects.toThrow('DEPENDENCY_MANIFEST_INVALID');
    expect(requested).toBe(false);
  });
});

function sha(value: Buffer): string { return createHash('sha256').update(value).digest('hex'); }

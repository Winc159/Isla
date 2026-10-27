import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PinnedResponse } from '../../src/web/transport.js';
import { DependencyManager, type DependencyManagerDependencies, type DependencyManifestV1 } from '../../src/dependencies/manager.js';

describe('DependencyManager', () => {
  let root: string | undefined;
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

  it('installs once from a pinned manifest, verifies version, lists and uninstalls atomically', async () => {
    root = await mkdtempRoot();
    const bytes = Buffer.from('fixed artifact');
    let downloads = 0;
    const manager = createManager(root, bytes, {
      requestPinned: async () => { downloads++; await new Promise(resolveDelay => setTimeout(resolveDelay, 20)); return response(bytes); },
    });
    const [first, repeated] = await Promise.all([manager.install('sample-tool', '^1.2.3'), manager.install('sample-tool', '1.2.3')]);
    expect(first).toEqual(repeated);
    expect(downloads).toBe(1);
    expect(first).toMatchObject({ id: 'sample-tool', version: '1.2.3', license: 'MIT', sha256: sha(bytes) });
    await expect(readFile(first.executables['bin/tool']!, 'utf8')).resolves.toBe('sample');
    await expect(manager.list()).resolves.toEqual([first]);
    await expect(manager.uninstall('sample-tool')).resolves.toBe(true);
    await expect(manager.list()).resolves.toEqual([]);
    await expect(readdir(join(root, 'sample-tool'))).resolves.toEqual([]);
  });

  it('rejects unsupported platforms and invalid manifest IDs without downloading', async () => {
    root = await mkdtempRoot();
    const bytes = Buffer.from('fixed artifact');
    let requested = false;
    const manager = createManager(root, bytes, { platform: 'linux', arch: 'arm64', requestPinned: async () => { requested = true; return response(bytes); } });
    await expect(manager.install('sample-tool')).rejects.toThrow('DEPENDENCY_UNAVAILABLE_FOR_PLATFORM');
    await expect(manager.install('../escape')).rejects.toThrow('DEPENDENCY_ID_INVALID');
    expect(requested).toBe(false);
  });

  it('cleans staging files after hash and version verification failures', async () => {
    root = await mkdtempRoot();
    const bytes = Buffer.from('bad artifact');
    const hashManager = createManager(root, bytes, { requestPinned: async () => response(bytes) });
    await expect(hashManager.install('sample-tool')).rejects.toThrow('DEPENDENCY_HASH_MISMATCH');
    await expect(readdir(join(root, 'sample-tool'))).resolves.toEqual([]);

    const good = Buffer.from('fixed artifact');
    const versionManager = createManager(root, good, { requestPinned: async () => response(good), verifyVersion: async () => { throw new Error('DEPENDENCY_VERSION_VERIFICATION_FAILED'); } });
    await expect(versionManager.install('sample-tool')).rejects.toThrow('DEPENDENCY_VERSION_VERIFICATION_FAILED');
    await expect(readdir(join(root, 'sample-tool'))).resolves.toEqual([]);
    await expect(versionManager.list()).resolves.toEqual([]);
  });

  it('rejects registry entries that redirect executable paths outside managed storage', async () => {
    root = await mkdtempRoot();
    const bytes = Buffer.from('fixed artifact');
    const manager = createManager(root, bytes, { requestPinned: async () => response(bytes) });
    const entry = await manager.install('sample-tool');
    const registryPath = join(root, 'registry-v1.json');
    await writeFile(registryPath, JSON.stringify({ version: 1, dependencies: [{ ...entry, executables: { 'bin/tool': 'D:/outside/tool' } }] }));
    await expect(manager.list()).rejects.toThrow('DEPENDENCY_REGISTRY_INVALID');
  });

  it('rejects arbitrary URLs and invalid checksums in manifests', async () => {
    const invalid = { ...manifest(Buffer.from('fixed artifact')), source: 'https://user:pass@artifacts.example.test/a' };
    expect(() => new DependencyManager({ manifests: [invalid], root: 'D:/unused' })).toThrow('DEPENDENCY_MANIFEST_INVALID');
  });
});

function createManager(rootPath: string, bytes: Buffer, dependencies: DependencyManagerDependencies = {}): DependencyManager {
  const value = manifest(Buffer.from('fixed artifact'));
  return new DependencyManager({
    manifests: [value], root: rootPath, dependencies: {
      platform: process.platform,
      arch: process.arch,
      now: () => new Date('2026-10-27T00:00:00.000Z'),
      resolveAddresses: async () => [{ address: '93.184.216.34', family: 4 }],
      requestPinned: async () => response(bytes),
      extractArchive: async (_archive, destination) => { await mkdir(join(destination, 'bin'), { recursive: true }); const executable = join(destination, 'bin', 'tool'); await writeFile(executable, 'sample'); await chmod(executable, 0o700); return ['bin/tool']; },
      verifyVersion: async (_path, _argv, expected) => { if (expected !== '1.2.3') throw new Error('DEPENDENCY_VERSION_VERIFICATION_FAILED'); },
      ...dependencies,
    },
  });
}

function manifest(bytes: Buffer): DependencyManifestV1 {
  return { id: 'sample-tool', version: '1.2.3', platform: process.platform, arch: process.arch, source: 'https://artifacts.example.test/sample.tar.gz', sha256: sha(bytes), maxDownloadBytes: 1024, archive: 'tar.gz', executables: ['bin/tool'], license: 'MIT', versionProbe: { executable: 'bin/tool', argv: ['--version'], expected: '1.2.3' } };
}

function response(bytes: Buffer): PinnedResponse {
  return { response: new Response(bytes) as unknown as PinnedResponse['response'], close: async () => undefined };
}
function sha(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
async function mkdtempRoot(): Promise<string> { return mkdtemp(join(tmpdir(), 'isla-dependency-manager-')); }

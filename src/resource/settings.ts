import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { LocalRuntimeConfigV1 } from '../config/local-runtime.js';
import { parseResourceConfig, type ResourceManagedRootV1 } from './config.js';

export interface ResourceDirectorySettingsView {
  readonly revision: string;
  readonly managedRoots: readonly ResourceManagedRootV1[];
  readonly defaultDestinationRootId: string;
}

export class ResourceSettingsStore {
  constructor(readonly path: string, private readonly runtime: LocalRuntimeConfigV1) {}

  async read(): Promise<ResourceDirectorySettingsView> {
    const source = await readFile(this.path, 'utf8');
    const config = parseResourceConfig(source, { directory: dirname(this.path), runtime: this.runtime });
    return { revision: revision(source), managedRoots: config.managedRoots, defaultDestinationRootId: config.defaultDestinationRootId };
  }

  async update(value: unknown): Promise<ResourceDirectorySettingsView> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('RESOURCE_SETTINGS_INVALID');
    const item = value as Record<string, unknown>;
    if (typeof item.revision !== 'string') throw new Error('RESOURCE_SETTINGS_REVISION_REQUIRED');
    const source = `${JSON.stringify({ version: 1, managedRoots: item.managedRoots, defaultDestinationRootId: item.defaultDestinationRootId }, null, 2)}\n`;
    parseResourceConfig(source, { directory: dirname(this.path), runtime: this.runtime });
    await mkdir(dirname(this.path), { recursive: true });
    const lockPath = `${this.path}.lock`;
    let lock;
    try { lock = await open(lockPath, 'wx'); }
    catch { throw new Error('RESOURCE_SETTINGS_BUSY'); }
    const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    try {
      const current = await readFile(this.path, 'utf8');
      if (revision(current) !== item.revision) throw new Error('RESOURCE_SETTINGS_REVISION_STALE');
      await writeFile(temporary, source, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, this.path);
    } finally {
      await unlink(temporary).catch(() => {});
      await lock.close();
      await unlink(lockPath).catch(() => {});
    }
    return this.read();
  }
}

function revision(source: string): string { return createHash('sha256').update(source, 'utf8').digest('hex'); }

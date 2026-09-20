import { createHash } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, unlink, writeFile, type FileHandle } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseConfigFile, type IslaConfigFileV1 } from './config.js';

export type ConfigLoadResult =
  | { readonly status: 'missing'; readonly path: string }
  | { readonly status: 'empty'; readonly path: string; readonly config: IslaConfigFileV1; readonly revision: string }
  | { readonly status: 'ready'; readonly path: string; readonly config: IslaConfigFileV1; readonly revision: string }
  | { readonly status: 'invalid'; readonly path: string; readonly message: string }
  | { readonly status: 'unreadable'; readonly path: string; readonly message: string };

export class ConfigStore {
  readonly path: string;

  constructor(path = defaultConfigPath()) {
    this.path = path;
  }

  async load(): Promise<ConfigLoadResult> {
    let source: string;
    try {
      source = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing', path: this.path };
      return { status: 'unreadable', path: this.path, message: safeIoMessage(error) };
    }
    try {
      const config = parseConfigFile(source);
      const revision = revisionOf(source);
      return { status: Object.keys(config.profiles).length ? 'ready' : 'empty', path: this.path, config, revision };
    } catch (error) {
      return { status: 'invalid', path: this.path, message: safeIoMessage(error) };
    }
  }

  async save(config: IslaConfigFileV1, expectedRevision?: string): Promise<{ readonly path: string; readonly revision: string }> {
    const source = `${JSON.stringify(config, null, 2)}\n`;
    const parsed = parseConfigFile(source);
    const canonical = `${JSON.stringify(parsed, null, 2)}\n`;
    const current = await this.readForSave(expectedRevision);
    await mkdir(dirname(this.path), { recursive: true });
    const lockPath = `${this.path}.lock`;
    const lock = await acquireLock(lockPath);
    const temporaryPath = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    try {
      const lockedCurrent = await this.readForSave(expectedRevision);
      if (lockedCurrent !== current) throw new Error('Isla config changed while waiting for its write lock');
      await writeFile(temporaryPath, canonical, { encoding: 'utf8', mode: 0o600 });
      await chmod(temporaryPath, 0o600).catch(() => {});
      parseConfigFile(await readFile(temporaryPath, 'utf8'));
      await rename(temporaryPath, this.path);
      await chmod(this.path, 0o600).catch(() => {});
      return { path: this.path, revision: revisionOf(canonical) };
    } finally {
      await unlink(temporaryPath).catch(() => {});
      await lock.close();
      await unlink(lockPath).catch(() => {});
    }
  }

  private async readForSave(expectedRevision?: string): Promise<string | undefined> {
    let source: string | undefined;
    try { source = await readFile(this.path, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') source = undefined;
      else throw new Error(`Unable to read Isla config: ${safeIoMessage(error)}`);
    }
    const actualRevision = source === undefined ? undefined : revisionOf(source);
    if (expectedRevision !== undefined && actualRevision !== expectedRevision) throw new Error('Isla config was changed by another process');
    if (expectedRevision === undefined && source !== undefined) throw new Error('Isla config already exists; an expected revision is required to replace it');
    return source;
  }
}

export function defaultConfigPath(): string { return join(homedir(), '.isla', 'config.json'); }

export function revisionOf(source: string): string { return createHash('sha256').update(source, 'utf8').digest('hex'); }

function safeIoMessage(error: unknown): string {
  if (error instanceof Error && error.message && !/[\r\n]/.test(error.message)) {
    const message = error.message.replace(/(?:[A-Za-z]:)?[^\s']*[\\/][^']*/g, '<path>');
    return message.length <= 240 ? message : message.slice(0, 240);
  }
  return 'Unable to access Isla config';
}

async function acquireLock(lockPath: string): Promise<FileHandle> {
  try {
    const handle = await open(lockPath, 'wx');
    await handle.writeFile(String(process.pid), 'utf8');
    return handle;
  } catch (error) {
    throw new Error(`Unable to lock Isla config: ${safeIoMessage(error)}`);
  }
}

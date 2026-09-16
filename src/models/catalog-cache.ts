import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import type { ModelCatalogEntry } from './catalog.js';

interface CacheFile<T extends ModelCatalogEntry> { readonly version: 1; readonly fetchedAt: string; readonly models: readonly T[]; readonly identity?: string; }

export async function readModelCatalogCache<T extends ModelCatalogEntry = ModelCatalogEntry>(path: string, expectedIdentity?: string): Promise<{ readonly fetchedAt: string; readonly models: readonly T[] } | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as CacheFile<T>;
    if (value.version !== 1 || typeof value.fetchedAt !== 'string' || !Array.isArray(value.models)) return undefined;
    if (expectedIdentity !== undefined && value.identity !== undefined && value.identity !== expectedIdentity) return undefined;
    return { fetchedAt: value.fetchedAt, models: value.models };
  } catch { return undefined; }
}

export async function writeModelCatalogCache<T extends ModelCatalogEntry>(path: string, models: readonly T[], identity?: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ version: 1, fetchedAt: new Date().toISOString(), models, ...(identity ? { identity } : {}) }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try { await rename(temporary, path); } finally { await unlink(temporary).catch(() => {}); }
}

export function modelCatalogCacheIdentity(providerId: string, profileName: string, endpoint: string): string {
  return createHash('sha256').update(`${providerId}\0${profileName}\0${endpoint}`, 'utf8').digest('hex');
}

export function modelCatalogCachePath(configPath: string, providerId: string, profileName: string, endpoint: string): string {
  return `${configPath}.models-${modelCatalogCacheIdentity(providerId, profileName, endpoint)}.json`;
}

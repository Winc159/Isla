import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { BailianModelCatalogEntry } from './bailian-catalog.js';

interface CacheFile { readonly version: 1; readonly fetchedAt: string; readonly models: readonly BailianModelCatalogEntry[]; }

export async function readModelCatalogCache(path: string): Promise<{ readonly fetchedAt: string; readonly models: readonly BailianModelCatalogEntry[] } | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as CacheFile;
    if (value.version !== 1 || typeof value.fetchedAt !== 'string' || !Array.isArray(value.models)) return undefined;
    return { fetchedAt: value.fetchedAt, models: value.models };
  } catch { return undefined; }
}

export async function writeModelCatalogCache(path: string, models: readonly BailianModelCatalogEntry[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ version: 1, fetchedAt: new Date().toISOString(), models }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try { await rename(temporary, path); } finally { await unlink(temporary).catch(() => {}); }
}

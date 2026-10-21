import { realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function resolveWorkspace(explicitPath: string | undefined, profilePath: string | undefined, cwd: string): Promise<string> {
  const selected = explicitPath?.trim() || profilePath?.trim() || cwd;
  if (!selected) throw new Error('Isla workspace is required');
  const absolute = resolve(cwd, selected);
  try {
    const info = await stat(absolute);
    if (!info.isDirectory()) throw new Error('not a directory');
    return await realpath(absolute);
  } catch {
    throw new Error('Isla workspace must be an accessible directory');
  }
}

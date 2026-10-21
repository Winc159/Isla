import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function isCliEntry(moduleUrl: string, argvEntry: string | undefined): boolean {
  if (!argvEntry) return false;
  return canonicalPath(fileURLToPath(moduleUrl)) === canonicalPath(argvEntry);
}

function canonicalPath(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

import { chmod, mkdir, open, readFile } from 'node:fs/promises';
import { dirname, posix, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const BLOCK_BYTES = 512;
const MAX_ARCHIVE_BYTES = 1_000_000_000;
const MAX_ARCHIVE_FILES = 20_000;

export async function extractTarGzip(archivePath: string, destination: string, executables: readonly string[]): Promise<readonly string[]> {
  const compressed = await readFile(archivePath);
  const archive = gunzipSync(compressed, { maxOutputLength: MAX_ARCHIVE_BYTES });
  const executablePaths = new Set(executables.map(validateArchivePath));
  const extracted = new Set<string>();
  const root = resolve(destination);
  let offset = 0;
  let files = 0;
  let sawEnd = false;
  while (offset + BLOCK_BYTES <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK_BYTES);
    offset += BLOCK_BYTES;
    if (header.every(byte => byte === 0)) { sawEnd = true; break; }
    validateHeaderChecksum(header);
    const name = readString(header.subarray(0, 100));
    const prefix = readString(header.subarray(345, 500));
    const path = validateArchivePath(prefix ? `${prefix}/${name}` : name);
    files++;
    if (files > MAX_ARCHIVE_FILES) throw new Error('DEPENDENCY_ARCHIVE_TOO_MANY_FILES');
    if (extracted.has(path)) throw new Error('DEPENDENCY_ARCHIVE_DUPLICATE_PATH');
    extracted.add(path);
    const size = readOctal(header.subarray(124, 136));
    const type = header[156];
    if (type !== 0 && type !== 48 && type !== 53) throw new Error('DEPENDENCY_ARCHIVE_UNSUPPORTED_ENTRY');
    if (type === 53 && size !== 0) throw new Error('DEPENDENCY_ARCHIVE_INVALID');
    if (size > archive.length - offset) throw new Error('DEPENDENCY_ARCHIVE_INVALID');
    const target = resolve(root, ...path.split('/'));
    if (!isInside(root, target)) throw new Error('DEPENDENCY_ARCHIVE_PATH_TRAVERSAL');
    if (type === 53) await mkdir(target, { recursive: true });
    else {
      await mkdir(dirname(target), { recursive: true });
      const handle = await open(target, 'wx', 0o600);
      try { await handle.writeFile(archive.subarray(offset, offset + size)); await handle.sync(); }
      finally { await handle.close(); }
      if (executablePaths.has(path)) await chmod(target, process.platform === 'win32' ? 0o700 : 0o700);
    }
    offset += Math.ceil(size / BLOCK_BYTES) * BLOCK_BYTES;
  }
  if (!sawEnd) throw new Error('DEPENDENCY_ARCHIVE_INVALID');
  for (const executable of executablePaths) if (!extracted.has(executable)) throw new Error('DEPENDENCY_EXECUTABLE_MISSING');
  return [...extracted];
}

function validateArchivePath(value: string): string {
  const path = value.replace(/\/+$/u, '');
  if (!path || path.includes('\\') || path.includes('\0') || path.startsWith('/') || /^[a-z]:/iu.test(path)) throw new Error('DEPENDENCY_ARCHIVE_PATH_TRAVERSAL');
  const segments = path.split('/');
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) throw new Error('DEPENDENCY_ARCHIVE_PATH_TRAVERSAL');
  const normalized = posix.normalize(path);
  if (normalized !== path || normalized === '..' || normalized.startsWith('../')) throw new Error('DEPENDENCY_ARCHIVE_PATH_TRAVERSAL');
  return normalized;
}

function validateHeaderChecksum(header: Buffer): void {
  const expected = readOctal(header.subarray(148, 156));
  let actual = 0;
  for (let index = 0; index < header.length; index++) actual += index >= 148 && index < 156 ? 32 : header[index]!;
  if (actual !== expected) throw new Error('DEPENDENCY_ARCHIVE_CHECKSUM_INVALID');
}

function readString(field: Buffer): string {
  const end = field.indexOf(0);
  return new TextDecoder('utf-8', { fatal: true }).decode(end === -1 ? field : field.subarray(0, end));
}

function readOctal(field: Buffer): number {
  const value = field.toString('ascii').replace(/\0.*$/u, '').trim();
  if (!value) return 0;
  if (!/^[0-7]+$/u.test(value)) throw new Error('DEPENDENCY_ARCHIVE_INVALID');
  const number = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('DEPENDENCY_ARCHIVE_INVALID');
  return number;
}

function isInside(root: string, target: string): boolean {
  const path = posix.relative(root.replaceAll('\\', '/'), target.replaceAll('\\', '/'));
  return path !== '..' && !path.startsWith('../') && !/^[A-Za-z]:/u.test(path);
}

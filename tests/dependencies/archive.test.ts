import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { extractTarGzip } from '../../src/dependencies/archive.js';

describe('dependency archive extraction', () => {
  let directory: string | undefined;
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });

  it('extracts only listed regular files and makes declared executables runnable', async () => {
    directory = await mkdtemp(join(tmpdir(), 'isla-dependency-archive-'));
    const archive = join(directory, 'package.tar.gz');
    const destination = join(directory, 'install');
    await writeFile(archive, makeTarGzip([{ path: 'bin/tool', content: 'tool data' }, { path: 'LICENSE', content: 'license text' }]));
    await expect(extractTarGzip(archive, destination, ['bin/tool'])).resolves.toEqual(['bin/tool', 'LICENSE']);
    await expect(readFile(join(destination, 'bin/tool'), 'utf8')).resolves.toBe('tool data');
    if (process.platform !== 'win32') expect((await stat(join(destination, 'bin/tool'))).mode & 0o111).not.toBe(0);
  });

  it.each(['../escape', '/absolute', 'a/../../escape'])('rejects archive traversal path %s', async path => {
    directory = await mkdtemp(join(tmpdir(), 'isla-dependency-archive-'));
    const archive = join(directory, 'package.tar.gz');
    const destination = join(directory, 'install');
    await writeFile(archive, makeTarGzip([{ path, content: 'bad' }]));
    await expect(extractTarGzip(archive, destination, [])).rejects.toThrow('DEPENDENCY_ARCHIVE_PATH_TRAVERSAL');
  });

  it('rejects links, unsupported special files, and missing required executables', async () => {
    directory = await mkdtemp(join(tmpdir(), 'isla-dependency-archive-'));
    const archive = join(directory, 'package.tar.gz');
    await writeFile(archive, makeTarGzip([{ path: 'link', content: '', type: '2' }]));
    await expect(extractTarGzip(archive, join(directory, 'links'), [])).rejects.toThrow('DEPENDENCY_ARCHIVE_UNSUPPORTED_ENTRY');
    await writeFile(archive, makeTarGzip([{ path: 'bin/other', content: 'x' }]));
    await expect(extractTarGzip(archive, join(directory, 'missing'), ['bin/tool'])).rejects.toThrow('DEPENDENCY_EXECUTABLE_MISSING');
  });

  it('rejects corrupted archive checksums', async () => {
    directory = await mkdtemp(join(tmpdir(), 'isla-dependency-archive-'));
    const archive = join(directory, 'package.tar.gz');
    const bytes = makeTarGzip([{ path: 'tool', content: 'x' }]);
    const { gunzipSync } = await import('node:zlib');
    const raw = gunzipSync(bytes);
    raw[5] = raw[5]! ^ 1;
    await writeFile(archive, gzipSync(raw));
    await expect(extractTarGzip(archive, join(directory, 'install'), [])).rejects.toThrow('DEPENDENCY_ARCHIVE_CHECKSUM_INVALID');
  });
});

function makeTarGzip(entries: readonly { readonly path: string; readonly content: string; readonly type?: string }[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const content = Buffer.from(entry.content);
    const header = Buffer.alloc(512);
    header.write(entry.path, 0, 100, 'utf8');
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, content.length);
    writeOctal(header, 136, 12, 0);
    header.fill(32, 148, 156);
    header[156] = (entry.type ?? '0').charCodeAt(0);
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
    blocks.push(header, content, Buffer.alloc((512 - content.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function writeOctal(header: Buffer, offset: number, length: number, value: number): void {
  header.write(`${value.toString(8).padStart(length - 1, '0')}\0`, offset, length, 'ascii');
}

/// <reference types="node" />

import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isCliEntry } from '../src/cli-entry.js';

const temporaryDirectory = () => mkdtemp(join(tmpdir(), 'isla-cli-entry-'));

describe('CLI entry detection', () => {
  it('recognizes a directly invoked entry', async () => {
    const root = await temporaryDirectory();
    const entry = join(root, 'cli.js');
    await writeFile(entry, '');

    expect(isCliEntry(pathToFileURL(entry).href, entry)).toBe(true);
  });

  it('recognizes an npm-link-style symbolic path', async () => {
    const root = await temporaryDirectory();
    const packageDirectory = join(root, 'package');
    const linkedDirectory = join(root, 'linked-package');
    await mkdir(packageDirectory);
    const entry = join(packageDirectory, 'cli.js');
    await writeFile(entry, '');
    await symlink(packageDirectory, linkedDirectory, 'junction');

    expect(isCliEntry(pathToFileURL(entry).href, join(linkedDirectory, 'cli.js'))).toBe(true);
  });

  it('rejects another executable', async () => {
    const root = await temporaryDirectory();
    const entry = join(root, 'cli.js');
    const other = join(root, 'other.js');
    await writeFile(entry, '');
    await writeFile(other, '');

    expect(isCliEntry(pathToFileURL(entry).href, other)).toBe(false);
  });
});

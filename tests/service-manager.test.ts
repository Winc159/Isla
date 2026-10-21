import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('service manager source', () => {
  it('uses absolute Node and entrypoint paths instead of relying on the systemd PATH', async () => {
    const source = await readFile(new URL('../src/host/service-manager.ts', import.meta.url), 'utf8');
    expect(source).toContain('process.execPath');
    expect(source).toContain("join(dist, 'entrypoints', 'host.js')");
    expect(source).toContain("enable', '--now'");
  });
});

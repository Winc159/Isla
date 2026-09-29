import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CredentialVault } from '../src/browser/vault.js';
describe('CredentialVault persistence', () => {
  it('writes encrypted data and locks after explicit lock', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'isla-vault-')); const path = join(dir, 'vault.json');
    try { const vault = new CredentialVault(path); await vault.save('master', [{ origin: 'https://example.com', label: 'main', username: 'u', password: 'secret' }]); expect(vault.list()).toEqual([{ origin: 'https://example.com', label: 'main', username: 'u' }]); vault.lock(); expect(vault.locked).toBe(true); await vault.unlock('master'); expect(vault.get('https://example.com', 'main')?.password).toBe('secret'); } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

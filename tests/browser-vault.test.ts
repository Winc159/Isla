import { describe, expect, it } from 'vitest';
import { decryptVault, encryptVault } from '../src/browser/vault.js';
describe('browser vault', () => {
  it('encrypts and decrypts entries without storing plaintext', async () => {
    const envelope = await encryptVault([{ origin: 'https://example.com', label: 'main', username: 'u', password: 'secret' }], 'master');
    expect(JSON.stringify(envelope)).not.toContain('secret');
    await expect(decryptVault(envelope, 'master')).resolves.toEqual([{ origin: 'https://example.com', label: 'main', username: 'u', password: 'secret' }]);
    await expect(decryptVault(envelope, 'wrong')).rejects.toThrow();
  });
});

import { randomBytes, scrypt as scryptCallback, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, rename, writeFile, mkdir, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
const scrypt = promisify(scryptCallback);
const VERSION = 1;
export interface VaultEntry { readonly origin: string; readonly label: string; readonly username: string; readonly password: string; }
export interface VaultEnvelope { readonly version: 1; readonly salt: string; readonly iv: string; readonly tag: string; readonly ciphertext: string; }
export async function encryptVault(entries: readonly VaultEntry[], masterPassword: string): Promise<VaultEnvelope> {
  const salt = randomBytes(16); const iv = randomBytes(12); const key = await scrypt(masterPassword, salt, 32) as Buffer;
  const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(`isla-vault-v${VERSION}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(entries), 'utf8'), cipher.final()]);
  return { version: 1, salt: salt.toString('base64url'), iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url') };
}
export async function decryptVault(envelope: VaultEnvelope, masterPassword: string): Promise<readonly VaultEntry[]> {
  if (envelope.version !== 1) throw new Error('VAULT_VERSION_UNSUPPORTED');
  const key = await scrypt(masterPassword, Buffer.from(envelope.salt, 'base64url'), 32) as Buffer;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64url')); decipher.setAAD(Buffer.from(`isla-vault-v${VERSION}`)); decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
  const plain = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  return JSON.parse(plain) as readonly VaultEntry[];
}

export class CredentialVault {
  private entries: readonly VaultEntry[] = [];
  private unlockedUntil = 0;
  constructor(private readonly path: string, private readonly timeoutMs = 15 * 60_000) {}
  get locked(): boolean { return this.unlockedUntil <= Date.now(); }
  async unlock(masterPassword: string): Promise<void> { if (!masterPassword) throw new Error('VAULT_PASSWORD_REQUIRED'); const envelope = JSON.parse(await readFile(this.path, 'utf8')) as VaultEnvelope; this.entries = (await decryptVault(envelope, masterPassword)).map(entry => ({ ...entry, origin: normalizeOrigin(entry.origin) })); this.unlockedUntil = Date.now() + this.timeoutMs; }
  lock(): void { this.entries = []; this.unlockedUntil = 0; }
  list(): readonly Omit<VaultEntry, 'password'>[] { if (this.locked) return []; return this.entries.map(({ password: _password, ...safe }) => safe); }
  get(origin: string, label: string): VaultEntry | undefined { if (this.locked) throw new Error('VAULT_LOCKED'); return this.entries.find(entry => entry.origin === origin && entry.label === label); }
  async save(masterPassword: string, entries: readonly VaultEntry[]): Promise<void> { if (!masterPassword) throw new Error('VAULT_PASSWORD_REQUIRED'); const normalized = entries.map(entry => ({ ...entry, origin: normalizeOrigin(entry.origin) })); const envelope = await encryptVault(normalized, masterPassword); const temporary = `${this.path}.tmp-${process.pid}`; await mkdir(dirname(this.path), { recursive: true, mode: 0o700 }); await writeFile(temporary, JSON.stringify(envelope), { mode: 0o600 }); await chmod(temporary, 0o600); await rename(temporary, this.path); await chmod(this.path, 0o600); this.entries = normalized; this.unlockedUntil = Date.now() + this.timeoutMs; }
}

function normalizeOrigin(input: string): string { let url: URL; try { url = new URL(input); } catch { throw new Error('VAULT_ORIGIN_INVALID'); } if (url.protocol !== 'https:' && !(url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1')) throw new Error('VAULT_ORIGIN_NOT_HTTPS'); return url.origin.toLowerCase(); }

import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface LocalRuntimeConfigV1 {
  readonly version: 1;
  readonly host: { readonly host: '127.0.0.1'; readonly port: number; readonly token: string };
  readonly resource: { readonly host: '127.0.0.1'; readonly port: number; readonly token: string };
}

export function defaultLocalRuntimeConfigPath(): string {
  return join(homedir(), '.isla', 'runtime.json');
}

export async function loadOrCreateLocalRuntimeConfig(path = defaultLocalRuntimeConfigPath()): Promise<LocalRuntimeConfigV1> {
  try {
    return parseLocalRuntimeConfig(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const created: LocalRuntimeConfigV1 = {
    version: 1,
    host: { host: '127.0.0.1', port: 43110, token: randomBytes(32).toString('hex') },
    resource: { host: '127.0.0.1', port: 43111, token: randomBytes(32).toString('hex') },
  };
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, `${JSON.stringify(created, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await chmod(path, 0o600).catch(() => {});
    return created;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    return parseLocalRuntimeConfig(await readFile(path, 'utf8'));
  }
}

export function parseLocalRuntimeConfig(source: string): LocalRuntimeConfigV1 {
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new Error('Invalid Isla runtime config JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || (value as { version?: unknown }).version !== 1) throw new Error('Isla runtime config version must be 1');
  const root = value as Record<string, unknown>;
  return { version: 1, host: endpoint(root.host, 'host'), resource: endpoint(root.resource, 'resource') };
}

function endpoint(value: unknown, name: string): { host: '127.0.0.1'; port: number; token: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Isla runtime ${name} must be an object`);
  const item = value as Record<string, unknown>;
  if (item.host !== '127.0.0.1') throw new Error(`Isla runtime ${name} must use loopback`);
  if (!Number.isSafeInteger(item.port) || (item.port as number) < 1 || (item.port as number) > 65_535) throw new Error(`Isla runtime ${name} port is invalid`);
  if (typeof item.token !== 'string' || item.token.length < 32) throw new Error(`Isla runtime ${name} token is invalid`);
  return { host: '127.0.0.1', port: item.port as number, token: item.token };
}

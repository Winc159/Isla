import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface McpOAuthState {
  readonly clients: Readonly<Record<string, unknown>>;
  readonly tokens: Readonly<Record<string, unknown>>;
  readonly discoveryState?: unknown;
  readonly codeVerifier?: string;
}

const EMPTY: McpOAuthState = { clients: {}, tokens: {} };

export class McpOAuthStore {
  private writeTail: Promise<void> = Promise.resolve();
  readonly path: string;

  constructor(root: string, serverId: string, endpoint: string) {
    const id = createHash('sha256').update(`${serverId}\0${endpoint}`).digest('hex');
    this.path = join(root, `${id}.json`);
  }

  async load(): Promise<McpOAuthState> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (!isRecord(parsed) || !isRecord(parsed.clients) || !isRecord(parsed.tokens)) throw new Error('MCP_OAUTH_STORE_INVALID');
      return parsed as unknown as McpOAuthState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY;
      throw new Error('MCP_OAUTH_STORE_UNAVAILABLE');
    }
  }

  async save(state: McpOAuthState): Promise<void> {
    await this.enqueue(() => this.write(state));
  }

  async update(transform: (state: McpOAuthState) => McpOAuthState): Promise<void> {
    await this.enqueue(async () => this.write(transform(await this.load())));
  }

  private async write(state: McpOAuthState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600 });
      await chmod(temporary, 0o600).catch(() => {});
      await rename(temporary, this.path);
      await chmod(this.path, 0o600).catch(() => {});
    } finally { await unlink(temporary).catch(() => {}); }
  }

  private async enqueue(operation: () => Promise<void>): Promise<void> {
    const pending = this.writeTail.then(operation);
    this.writeTail = pending.catch(() => undefined);
    await pending;
  }
}

export function defaultMcpOAuthStoreRoot(): string { return join(homedir(), '.isla', 'mcp-oauth'); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

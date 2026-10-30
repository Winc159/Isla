import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { IslaMcpOAuthProvider } from '../src/mcp/oauth-provider.js';
import { McpOAuthStore } from '../src/mcp/oauth-store.js';

let root: string | undefined;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

describe('MCP OAuth persistence boundary', () => {
  it('isolates credentials per server and writes private files without exposing tokens in paths', async () => {
    root = await mkdtemp(join(tmpdir(), 'isla-mcp-oauth-'));
    const store = new McpOAuthStore(root, 'docs', 'https://mcp.example.test/mcp');
    const provider = new IslaMcpOAuthProvider('https://isla.example.test/mcp/oauth/callback/docs', store);
    await provider.saveClientInformation({ client_id: 'fixture-client', client_secret: 'fixture-secret' } as never, { issuer: 'https://issuer.example.test' });
    await provider.saveTokens({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', token_type: 'Bearer' } as never, { issuer: 'https://issuer.example.test' });
    const saved = await store.load();
    expect(saved.clients['https://issuer.example.test']).toMatchObject({ client_id: 'fixture-client' });
    expect(saved.tokens['https://issuer.example.test']).toMatchObject({ refresh_token: 'fixture-refresh' });
    expect(await provider.tokens()).toBeUndefined();
    expect(store.path).not.toContain('fixture-access');
    if (process.platform !== 'win32') expect((await stat(store.path)).mode & 0o777).toBe(0o600);
  });

  it('fails closed on corrupt credential state rather than silently replacing it', async () => {
    root = await mkdtemp(join(tmpdir(), 'isla-mcp-oauth-'));
    const store = new McpOAuthStore(root, 'docs', 'https://mcp.example.test/mcp');
    await writeFile(store.path, '{ broken');
    await expect(store.load()).rejects.toThrow('MCP_OAUTH_STORE_UNAVAILABLE');
  });

  it('clears one-time PKCE verifier after completion while retaining refresh credentials', async () => {
    root = await mkdtemp(join(tmpdir(), 'isla-mcp-oauth-'));
    const store = new McpOAuthStore(root, 'docs', 'https://mcp.example.test/mcp');
    const provider = new IslaMcpOAuthProvider('https://isla.example.test/callback', store);
    await provider.saveCodeVerifier('fixture-verifier');
    await provider.saveTokens({ refresh_token: 'fixture-refresh' } as never, { issuer: 'https://issuer.example.test' });
    await provider.clearAuthorization();
    await expect(provider.codeVerifier()).rejects.toThrow('MCP_OAUTH_VERIFIER_UNAVAILABLE');
    expect((await store.load()).tokens['https://issuer.example.test']).toMatchObject({ refresh_token: 'fixture-refresh' });
    expect(await readFile(store.path, 'utf8')).not.toContain('fixture-verifier');
  });

  it('allows local-only HTTP authorization endpoints but rejects public HTTP', async () => {
    root = await mkdtemp(join(tmpdir(), 'isla-mcp-oauth-'));
    const provider = new IslaMcpOAuthProvider('http://127.0.0.1:43110/callback', new McpOAuthStore(root, 'docs', 'http://127.0.0.1:43111/mcp'));
    await expect(provider.redirectToAuthorization(new URL('http://localhost:43112/authorize'))).resolves.toBeUndefined();
    await expect(provider.redirectToAuthorization(new URL('http://issuer.example.test/authorize'))).rejects.toThrow('MCP_OAUTH_AUTHORIZATION_URL_INVALID');
  });
});

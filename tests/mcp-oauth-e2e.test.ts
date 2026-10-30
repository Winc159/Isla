import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { McpHost } from '../src/mcp/host.js';

type PendingCode = { readonly challenge: string; readonly redirectUri: string; readonly issuer: string };
type OAuthFixture = { readonly server: Server; readonly issuer: string; readonly mcpUrl: string; readonly stop: () => Promise<void>; tokenExchanges: number; mcpCalls: number; readonly methods: string[] };

const roots: string[] = [];
const hosts: McpHost[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.close()));
  await Promise.all(servers.splice(0).map(server => closeServer(server)));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('MCP OAuth + Streamable HTTP end-to-end', () => {
  it('discovers OAuth, validates state and issuer, exchanges PKCE code, then calls a protected MCP tool', async () => {
    const fixture = await startOAuthMcpFixture();
    servers.push(fixture.server);
    const host = await connectHost(fixture);
    expect(host.statuses()[0]).toMatchObject({ state: 'auth-required', errorCode: 'MCP_AUTH_REQUIRED' });

    const authorizationUrl = new URL(host.authorizationUrl('docs')!);
    expect(authorizationUrl.searchParams.get('response_type')).toBe('code');
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizationUrl.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    const deniedState = await simulateBrowserAuthorization(authorizationUrl, { state: 'forged-state' });
    await expect(host.finishAuthorization('docs', deniedState)).rejects.toBeTruthy();
    expect(fixture.tokenExchanges).toBe(0);

    const deniedIssuer = await simulateBrowserAuthorization(authorizationUrl, { issuer: 'http://attacker.invalid' });
    await expect(host.finishAuthorization('docs', deniedIssuer)).rejects.toBeTruthy();
    expect(fixture.tokenExchanges).toBe(0);

    const callback = await simulateBrowserAuthorization(authorizationUrl);
    await host.finishAuthorization('docs', callback);
    expect(host.statuses()[0]).toMatchObject({ state: 'ready', toolCount: 1, tools: ['mcp__docs__echo'] });
    const echo = host.capabilities()[0]!.tools.find(tool => tool.definition.name === 'mcp__docs__echo')!;
    await expect(echo.execute('{"text":"authorized"}')).resolves.toBe('oauth:authorized');
    expect(fixture.tokenExchanges).toBe(1);
    expect(fixture.mcpCalls).toBe(1);
    expect(fixture.methods).toEqual(expect.arrayContaining(['tools/list', 'resources/list', 'resources/templates/list', 'prompts/list', 'tools/call']));
  }, 30_000);

  it('handles authorization denial without exchanging a token or enabling MCP tools', async () => {
    const fixture = await startOAuthMcpFixture();
    servers.push(fixture.server);
    const host = await connectHost(fixture);
    const authorizationUrl = new URL(host.authorizationUrl('docs')!);
    const denied = await simulateBrowserAuthorization(authorizationUrl, { deny: true });
    await expect(host.finishAuthorization('docs', denied)).rejects.toBeTruthy();
    expect(fixture.tokenExchanges).toBe(0);
    expect(host.statuses()[0]?.state).toBe('auth-required');
    expect(host.capabilities()).toEqual([]);
  }, 30_000);
});

async function startOAuthMcpFixture(): Promise<OAuthFixture> {
  const codes = new Map<string, PendingCode>();
  let tokenExchanges = 0;
  let mcpCalls = 0;
  const methods: string[] = [];
  let issuer = '';
  let mcpUrl = '';
  const server = createServer((request, response) => { void route(request, response); });
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('OAUTH_FIXTURE_NO_ADDRESS');
  issuer = `http://127.0.0.1:${address.port}`;
  mcpUrl = `${issuer}/mcp`;

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', issuer);
    if (request.method === 'GET' && url.pathname === '/.well-known/oauth-protected-resource/mcp') {
      sendJson(response, 200, { resource: mcpUrl, authorization_servers: [issuer], scopes_supported: ['mcp:tools'] }); return;
    }
    if (request.method === 'GET' && url.pathname === '/.well-known/oauth-protected-resource') {
      sendJson(response, 200, { resource: mcpUrl, authorization_servers: [issuer], scopes_supported: ['mcp:tools'] }); return;
    }
    if (request.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
      sendJson(response, 200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, registration_endpoint: `${issuer}/register`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'], authorization_response_iss_parameter_supported: true }); return;
    }
    if (request.method === 'POST' && url.pathname === '/register') {
      await readBody(request);
      sendJson(response, 201, { client_id: 'isla-fixture-client', redirect_uris: [`${issuer}/callback`] }); return;
    }
    if (request.method === 'GET' && url.pathname === '/authorize') {
      const redirectUri = url.searchParams.get('redirect_uri') ?? '';
      const state = url.searchParams.get('state') ?? '';
      const challenge = url.searchParams.get('code_challenge') ?? '';
      if (url.searchParams.get('code_challenge_method') !== 'S256' || !challenge || !state || !redirectUri) { response.writeHead(400).end(); return; }
      const code = `fixture-${randomUUID()}`;
      codes.set(code, { challenge, redirectUri, issuer });
      const callback = new URL(redirectUri);
      callback.searchParams.set('code', code);
      callback.searchParams.set('state', state);
      callback.searchParams.set('iss', issuer);
      response.writeHead(302, { location: callback.toString() }).end(); return;
    }
    if (request.method === 'POST' && url.pathname === '/token') {
      const body = new URLSearchParams(await readBody(request));
      const record = codes.get(body.get('code') ?? '');
      const verifier = body.get('code_verifier') ?? '';
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      if (!record || record.challenge !== challenge || body.get('grant_type') !== 'authorization_code' || body.get('redirect_uri') !== record.redirectUri) { sendJson(response, 400, { error: 'invalid_grant' }); return; }
      codes.delete(body.get('code')!);
      tokenExchanges += 1;
      sendJson(response, 200, { access_token: 'fixture-access-token', refresh_token: 'fixture-refresh-token', token_type: 'Bearer', expires_in: 3600, scope: 'mcp:tools' }); return;
    }
    if (request.method === 'POST' && url.pathname === '/mcp') {
      if (request.headers.authorization !== 'Bearer fixture-access-token') {
        response.writeHead(401, { 'www-authenticate': `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource/mcp", scope="mcp:tools"` }).end(); return;
      }
      const body = JSON.parse(await readBody(request)) as { id?: number | string; method?: string; params?: Record<string, unknown> };
      if (body.method) methods.push(body.method);
      if (body.id === undefined) { response.writeHead(202).end(); return; }
      if (body.method === 'initialize') {
        sendJson(response, 200, { jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: 'independent-oauth-fixture', version: '1.0.0' } } }); return;
      }
      if (body.method === 'tools/list') {
        sendJson(response, 200, { jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'echo', description: 'Echo with an OAuth-protected independent fixture.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] } }); return;
      }
      if (body.method === 'tools/call') {
        mcpCalls += 1;
        const args = body.params?.arguments as { text?: string } | undefined;
        sendJson(response, 200, { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: `oauth:${args?.text ?? ''}` }] } }); return;
      }
      if (body.method === 'resources/list') { sendJson(response, 200, { jsonrpc: '2.0', id: body.id, result: { resources: [] } }); return; }
      if (body.method === 'resources/templates/list') { sendJson(response, 200, { jsonrpc: '2.0', id: body.id, result: { resourceTemplates: [] } }); return; }
      if (body.method === 'prompts/list') { sendJson(response, 200, { jsonrpc: '2.0', id: body.id, result: { prompts: [] } }); return; }
      sendJson(response, 200, { jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not found' } }); return;
    }
    response.writeHead(404).end();
  }

  return { server, issuer, mcpUrl, methods, get tokenExchanges() { return tokenExchanges; }, get mcpCalls() { return mcpCalls; }, stop: () => closeServer(server) };
}

async function connectHost(fixture: OAuthFixture): Promise<McpHost> {
  const root = await mkdtemp(join(tmpdir(), 'isla-mcp-oauth-e2e-'));
  roots.push(root);
  const host = new McpHost([{ id: 'docs', transport: 'streamable-http', url: fixture.mcpUrl, required: true, startupTimeoutMs: 10_000, callTimeoutMs: 5_000, env: {} }], { callbackBaseUrl: 'http://127.0.0.1:43110', oauthStoreRoot: root });
  hosts.push(host);
  await host.start();
  return host;
}

async function simulateBrowserAuthorization(authorizationUrl: URL, options: { readonly state?: string; readonly issuer?: string; readonly deny?: boolean } = {}): Promise<URLSearchParams> {
  const authorize = new URL(authorizationUrl);
  authorize.pathname = '/authorize';
  const response = await fetch(authorize, { redirect: 'manual' });
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get('location')!);
  if (options.state !== undefined) location.searchParams.set('state', options.state);
  if (options.issuer !== undefined) location.searchParams.set('iss', options.issuer);
  if (options.deny) { location.searchParams.delete('code'); location.searchParams.set('error', 'access_denied'); }
  return location.searchParams;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
}

async function closeServer(server: Server): Promise<void> { if (server.listening) await new Promise<void>(resolve => server.close(() => resolve())); }

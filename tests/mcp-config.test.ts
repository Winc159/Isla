import { describe, expect, it } from 'vitest';
import { parseConfigFile, profileToAppConfig } from '../src/config/schema.js';

const profile = (mcp: unknown) => parseConfigFile(JSON.stringify({ version: 1, defaultProfile: 'local', profiles: { local: { provider: 'local', model: 'fixture', baseURL: 'http://127.0.0.1:11434/v1', mcp } } })).profiles.local!;

describe('MCP profile configuration', () => {
  it('normalizes stdio servers and preserves old profiles without MCP', () => {
    const parsed = profile({ servers: [{ id: 'research', command: process.execPath, args: ['server.mjs'], cwd: 'workspace', required: true, startupTimeoutMs: 5000, callTimeoutMs: 12000, env: { FIXTURE_MODE: '1' } }] });
    const config = profileToAppConfig(parsed);
    expect(config.mcpServers).toEqual([{ id: 'research', transport: 'stdio', command: process.execPath, args: ['server.mjs'], cwd: 'workspace', required: true, startupTimeoutMs: 5000, callTimeoutMs: 12000, env: { FIXTURE_MODE: '1' } }]);
    expect(profileToAppConfig(profile(undefined)).mcpServers).toBeUndefined();
  });

  it('rejects duplicate ids, unknown transport and invalid env keys', () => {
    expect(() => profile({ servers: [{ id: 'x', command: 'node' }, { id: 'x', command: 'node' }] })).toThrow(/duplicated/);
    expect(() => profile({ servers: [{ id: 'x', command: 'node', transport: 'http' }] })).toThrow(/unsupported/);
    expect(() => profile({ servers: [{ id: 'x', command: 'node', env: { 'NOT-VALID': 'x' } }] })).toThrow(/env/);
  });

  it('accepts streamable HTTP on HTTPS and loopback while rejecting unsafe endpoints and headers', () => {
    expect(profile({ servers: [{ id: 'remote', transport: 'streamable-http', url: 'https://mcp.example.test/mcp', headers: { 'X-Workspace': 'demo' } }] }).mcp?.servers?.[0]).toMatchObject({ transport: 'streamable-http', url: 'https://mcp.example.test/mcp' });
    expect(profile({ servers: [{ id: 'local', transport: 'streamable-http', url: 'http://localhost:4311/mcp' }] }).mcp?.servers?.[0]?.transport).toBe('streamable-http');
    expect(() => profile({ servers: [{ id: 'unsafe', transport: 'streamable-http', url: 'http://example.test/mcp' }] })).toThrow(/HTTPS/);
    expect(() => profile({ servers: [{ id: 'unsafe', transport: 'streamable-http', url: 'https://example.test/mcp', headers: { Authorization: 'secret' } }] })).toThrow(/headers/);
    expect(() => profile({ servers: [{ id: 'unsafe', transport: 'streamable-http', url: 'https://example.test/mcp', headers: { 'X-Api-Key': 'secret' } }] })).toThrow(/headers/);
  });

  it('requires OAuth callback to be HTTPS except for loopback and rejects URL credentials/query', () => {
    expect(profile({ servers: [{ id: 'remote', transport: 'streamable-http', url: 'https://mcp.example.test/mcp', oauth: { callbackBaseUrl: 'https://isla.example.test/prefix/' } }] }).mcp?.servers?.[0]).toMatchObject({ oauth: { callbackBaseUrl: 'https://isla.example.test/prefix' } });
    expect(profile({ servers: [{ id: 'local', transport: 'streamable-http', url: 'http://localhost:4311/mcp', oauth: { callbackBaseUrl: 'http://127.0.0.1:43110' } }] }).mcp?.servers?.[0]?.oauth).toEqual({ callbackBaseUrl: 'http://127.0.0.1:43110' });
    expect(() => profile({ servers: [{ id: 'remote', transport: 'streamable-http', url: 'https://mcp.example.test/mcp', oauth: { callbackBaseUrl: 'http://isla.example.test' } }] })).toThrow(/HTTPS/);
    expect(() => profile({ servers: [{ id: 'remote', transport: 'streamable-http', url: 'https://mcp.example.test/mcp', oauth: { callbackBaseUrl: 'https://user:pass@isla.example.test' } }] })).toThrow(/HTTPS/);
    expect(() => profile({ servers: [{ id: 'remote', transport: 'streamable-http', url: 'https://mcp.example.test/mcp', oauth: { callbackBaseUrl: 'https://isla.example.test?token=secret' } }] })).toThrow(/HTTPS/);
  });
});


import { describe, expect, it } from 'vitest';
import { parseConfigFile, profileToAppConfig } from '../src/config.js';

const profile = (mcp: unknown) => parseConfigFile(JSON.stringify({ version: 1, defaultProfile: 'local', profiles: { local: { provider: 'local', model: 'fixture', baseURL: 'http://127.0.0.1:11434/v1', mcp } } })).profiles.local!;

describe('MCP profile configuration', () => {
  it('normalizes stdio servers and preserves old profiles without MCP', () => {
    const parsed = profile({ servers: [{ id: 'research', command: process.execPath, args: ['server.mjs'], cwd: 'workspace', required: true, startupTimeoutMs: 5000, callTimeoutMs: 12000, env: { FIXTURE_MODE: '1' } }] });
    const config = profileToAppConfig(parsed);
    expect(config.mcpServers).toEqual([{ id: 'research', transport: 'stdio', command: process.execPath, args: ['server.mjs'], cwd: 'workspace', required: true, startupTimeoutMs: 5000, callTimeoutMs: 12000, env: { FIXTURE_MODE: '1' } }]);
    expect(profileToAppConfig(profile(undefined)).mcpServers).toBeUndefined();
  });

  it('rejects duplicate ids, unsupported transport and invalid env keys', () => {
    expect(() => profile({ servers: [{ id: 'x', command: 'node' }, { id: 'x', command: 'node' }] })).toThrow(/duplicated/);
    expect(() => profile({ servers: [{ id: 'x', command: 'node', transport: 'http' }] })).toThrow(/stdio/);
    expect(() => profile({ servers: [{ id: 'x', command: 'node', env: { 'NOT-VALID': 'x' } }] })).toThrow(/env/);
  });
});


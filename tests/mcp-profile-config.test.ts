import { describe, expect, it } from 'vitest';
import { listMcpConfig, replaceMcpServers } from '../src/mcp/profile-config.js';
import type { IslaConfigFileV1 } from '../src/config.js';

const server = { id: 'local', transport: 'stdio' as const, command: 'node', args: ['server.mjs'], required: false, startupTimeoutMs: 10_000, callTimeoutMs: 60_000, env: { API_TOKEN: 'secret' } };
const config: IslaConfigFileV1 = { version: 1, defaultProfile: 'main', profiles: { main: { provider: 'local', model: 'test', baseURL: 'http://127.0.0.1:11434/v1', mcp: { servers: [server] } } } };

describe('MCP profile configuration', () => {
  it('lists only a safe summary', () => {
    expect(listMcpConfig(config, 'main')).toEqual([{ id: 'local', required: false, commandConfigured: true, argsCount: 1, cwdConfigured: false, envKeys: ['API_TOKEN'], startupTimeoutMs: 10_000, callTimeoutMs: 60_000 }]);
  });

  it('replaces one profile without mutating the input or other profiles', () => {
    const next = replaceMcpServers(config, 'main', []);
    expect(next.profiles.main.mcp?.servers).toEqual([]);
    expect(config.profiles.main.mcp?.servers).toHaveLength(1);
  });
});

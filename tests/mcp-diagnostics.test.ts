import { describe, expect, it } from 'vitest';
import { fingerprintMcpServers, projectMcpDiagnostic, projectMcpDiagnostics } from '../src/mcp/diagnostics.js';

describe('MCP diagnostics projection', () => {
  it('projects safe ready state without adding sensitive fields', () => {
    const result = projectMcpDiagnostic({ id: 'local', transport: 'stdio', required: false, state: 'ready', toolCount: 1, tools: ['mcp__local__echo'] });
    expect(result).toEqual({ id: 'local', state: 'ready', toolCount: 1, tools: ['mcp__local__echo'] });
    expect(result).not.toHaveProperty('command');
    expect(result).not.toHaveProperty('env');
  });

  it('maps stable errors to local recommendations', () => {
    expect(projectMcpDiagnostic({ id: 'local', transport: 'stdio', required: false, state: 'unavailable', toolCount: 0, tools: [], errorCode: 'MCP_TRANSPORT_CLOSED' })).toMatchObject({
      errorCode: 'MCP_TRANSPORT_CLOSED',
      recommendation: 'Server 已退出；重启 Isla 后会重新建立连接。',
    });
  });

  it('preserves deterministic status order', () => {
    expect(projectMcpDiagnostics([
      { id: 'a', transport: 'stdio', required: false, state: 'ready', toolCount: 0, tools: [] },
      { id: 'b', transport: 'stdio', required: true, state: 'starting', toolCount: 0, tools: [] },
    ]).map(item => item.id)).toEqual(['a', 'b']);
  });

  it('fingerprints MCP config without depending on env key insertion order', () => {
    const base = { id: 'local', transport: 'stdio' as const, command: 'node', args: ['server.mjs'], required: false, startupTimeoutMs: 10_000, callTimeoutMs: 60_000 };
    expect(fingerprintMcpServers([{ ...base, env: { B: '2', A: '1' } }])).toBe(fingerprintMcpServers([{ ...base, env: { A: '1', B: '2' } }]));
    expect(fingerprintMcpServers([{ ...base, env: { A: 'changed' } }])).not.toBe(fingerprintMcpServers([{ ...base, env: { A: '1' } }]));
    expect(fingerprintMcpServers(undefined)).toBe(fingerprintMcpServers([]));
  });

  it('keeps the safe status facts used by TTY and NDJSON identical', () => {
    const status = { id: 'local', transport: 'stdio' as const, required: true, state: 'ready' as const, toolCount: 1, tools: ['mcp__local__read'] };
    expect(projectMcpDiagnostic(status)).toMatchObject({ id: status.id, state: status.state, toolCount: status.toolCount, tools: status.tools });
  });
});

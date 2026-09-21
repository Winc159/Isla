import { describe, expect, it } from 'vitest';
import { projectMcpDiagnostic, projectMcpDiagnostics } from '../src/mcp/diagnostics.js';

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
});

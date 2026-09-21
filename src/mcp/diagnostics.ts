import type { McpStatus } from './types.js';

export interface McpDiagnostic {
  readonly id: string;
  readonly state: McpStatus['state'];
  readonly toolCount: number;
  readonly tools: readonly string[];
  readonly errorCode?: string;
  readonly recommendation?: string;
}

const recommendations: Readonly<Record<string, string>> = {
  MCP_SERVER_START_FAILED: '检查 command、args、cwd 和 Server 的启动输出。',
  MCP_TIMEOUT: '检查 Server 是否可执行，并适当增加 Profile 中的 timeout。',
  MCP_DISCOVERY_FAILED: '检查 Server 是否实现 MCP tools/list。',
  MCP_CATALOG_INVALID: '检查 Server 返回的工具名称和 schema。',
  MCP_CATALOG_LIMIT: '减少该 Server 暴露的工具数量。',
  MCP_TRANSPORT_CLOSED: 'Server 已退出；重启 Isla 后会重新建立连接。',
};

export function projectMcpDiagnostic(status: McpStatus): McpDiagnostic {
  return {
    id: status.id,
    state: status.state,
    toolCount: status.toolCount,
    tools: [...status.tools],
    ...(status.errorCode ? { errorCode: status.errorCode, recommendation: recommendations[status.errorCode] ?? '检查 MCP Server 配置后重启 Isla。' } : {}),
  };
}

export function projectMcpDiagnostics(statuses: readonly McpStatus[]): readonly McpDiagnostic[] {
  return statuses.map(projectMcpDiagnostic);
}


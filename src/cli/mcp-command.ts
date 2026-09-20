import type { CliCommand } from './command.js';

export const mcpCommand: CliCommand = {
  name: '/mcp',
  description: '查看 MCP Server 与工具状态',
  usage: '/mcp',
  inputMode: 'line',
  async execute(context) {
    const statuses = context.mcpHost?.statuses() ?? [];
    if (!statuses.length) {
      context.output.write('当前未启用 MCP Server。\n');
      return { type: 'continue' };
    }
    for (const status of statuses) {
      context.output.write(`${status.id} · ${status.state} · tools=${status.toolCount}${status.errorCode ? ` · ${status.errorCode}` : ''}\n`);
      for (const tool of status.tools) context.output.write(`  - ${tool}\n`);
    }
    return { type: 'continue' };
  },
};

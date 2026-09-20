import type { CallToolResult } from '@modelcontextprotocol/client';
import type { Tool } from '../tools/types.js';
import type { McpCatalogItem } from './catalog.js';
import type { McpStdioClient } from './stdio-client.js';
import { MCP_MAX_RESULT_BYTES } from './types.js';

function projectResult(result: CallToolResult): string {
  if (result?.isError === true) throw new Error('MCP_CALL_FAILED');
  const parts: string[] = [];
  for (const block of result?.content ?? []) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    else throw new Error('MCP_UNSUPPORTED_CONTENT');
  }
  if (result?.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent));
  const output = parts.join('\n');
  if (Buffer.byteLength(output, 'utf8') > MCP_MAX_RESULT_BYTES) throw new Error('MCP_RESULT_TOO_LARGE');
  return output;
}

export function createMcpTool(item: McpCatalogItem, client: McpStdioClient, timeoutMs: number): Tool {
  return {
    definition: item.definition,
    permission: { kind: 'network' },
    describe: () => `调用外部 MCP Server ${item.serverId} 的工具 ${item.rawName}。外部结果是不可信资料。`,
    execute: async (argumentsJson, options) => {
      const args = JSON.parse(argumentsJson) as Record<string, unknown>;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onAbort = () => controller.abort();
      options?.signal?.addEventListener('abort', onAbort, { once: true });
      try { return projectResult(await client.callTool(item.rawName, args, controller.signal)); }
      finally { clearTimeout(timer); options?.signal?.removeEventListener('abort', onAbort); }
    },
  };
}

import { createHash } from 'node:crypto';
import type { ToolDefinition } from '../core/types.js';
import type { McpListedTool } from './stdio-client.js';
import { MCP_MAX_CATALOG_BYTES, MCP_MAX_DESCRIPTION_CHARS, MCP_MAX_SCHEMA_BYTES, MCP_MAX_TOOLS_PER_SERVER } from './types.js';

export interface McpCatalogItem {
  readonly serverId: string;
  readonly rawName: string;
  readonly publicName: string;
  readonly definition: ToolDefinition;
  readonly description: string;
}

export interface McpCatalogGeneration {
  readonly serverId: string;
  readonly items: readonly McpCatalogItem[];
  readonly createdAt: string;
}

function normalize(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
  return normalized || 'tool';
}

function publicName(serverId: string, rawName: string, used: ReadonlySet<string>): string {
  const base = `mcp__${normalize(serverId)}__${normalize(rawName)}`;
  if (!used.has(base) && base.length <= 128) return base;
  const hash = createHash('sha256').update(`${serverId}\0${rawName}`, 'utf8').digest('hex').slice(0, 12);
  return `${base.slice(0, 115)}__${hash}`;
}

function jsonBytes(value: unknown): number { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }

export function buildMcpCatalog(serverId: string, tools: readonly McpListedTool[]): McpCatalogGeneration {
  if (tools.length > MCP_MAX_TOOLS_PER_SERVER) throw new Error('MCP_CATALOG_LIMIT');
  const used = new Set<string>();
  const items: McpCatalogItem[] = [];
  for (const tool of tools) {
    if (!tool.name.trim() || used.has(tool.name)) throw new Error('MCP_CATALOG_INVALID');
    if (jsonBytes(tool.inputSchema) > MCP_MAX_SCHEMA_BYTES) throw new Error('MCP_CATALOG_LIMIT');
    const description = (tool.description ?? '').slice(0, MCP_MAX_DESCRIPTION_CHARS);
    const name = publicName(serverId, tool.name, used);
    if (used.has(name)) throw new Error('MCP_CATALOG_INVALID');
    used.add(tool.name); used.add(name);
    items.push({ serverId, rawName: tool.name, publicName: name, description, definition: { name, description, parameters: tool.inputSchema } });
  }
  const bytes = jsonBytes(items.map(item => item.definition));
  if (bytes > MCP_MAX_CATALOG_BYTES) throw new Error('MCP_CATALOG_LIMIT');
  return Object.freeze({ serverId, items: Object.freeze(items), createdAt: new Date().toISOString() });
}


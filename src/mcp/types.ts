export const MCP_MAX_SERVERS = 8;
export const MCP_MAX_TOOLS_PER_SERVER = 64;
export const MCP_MAX_TOTAL_TOOLS = 128;
export const MCP_MAX_DESCRIPTION_CHARS = 2_048;
export const MCP_MAX_SCHEMA_BYTES = 64 * 1024;
export const MCP_MAX_CATALOG_BYTES = 512 * 1024;
export const MCP_MAX_RESULT_BYTES = 64 * 1024;

export interface McpServerConfig {
  readonly id: string;
  readonly transport: 'stdio';
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly required: boolean;
  readonly startupTimeoutMs: number;
  readonly callTimeoutMs: number;
  readonly env: Readonly<Record<string, string>>;
}

export interface McpStatus {
  readonly id: string;
  readonly transport: 'stdio';
  readonly required: boolean;
  readonly state: 'disabled' | 'starting' | 'ready' | 'unavailable' | 'closed';
  readonly toolCount: number;
  readonly tools: readonly string[];
  readonly errorCode?: string;
}


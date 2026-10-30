export const MCP_MAX_SERVERS = 8;
export const MCP_MAX_TOOLS_PER_SERVER = 64;
export const MCP_MAX_TOTAL_TOOLS = 128;
export const MCP_MAX_DESCRIPTION_CHARS = 2_048;
export const MCP_MAX_SCHEMA_BYTES = 64 * 1024;
export const MCP_MAX_CATALOG_BYTES = 512 * 1024;
export const MCP_MAX_RESULT_BYTES = 64 * 1024;
export const MCP_MAX_RESOURCES_PER_SERVER = 64;
export const MCP_MAX_PROMPTS_PER_SERVER = 64;
export const MCP_MAX_RESOURCE_TEMPLATES_PER_SERVER = 64;

export interface McpServerConfig {
  readonly id: string;
  readonly transport: 'stdio' | 'streamable-http';
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly oauth?: { readonly callbackBaseUrl?: string };
  readonly cwd?: string;
  readonly required: boolean;
  readonly startupTimeoutMs: number;
  readonly callTimeoutMs: number;
  readonly env: Readonly<Record<string, string>>;
}

export interface McpStatus {
  readonly id: string;
  readonly transport: McpServerConfig['transport'];
  readonly required: boolean;
  readonly state: 'disabled' | 'starting' | 'ready' | 'auth-required' | 'unavailable' | 'closed';
  readonly toolCount: number;
  readonly tools: readonly string[];
  readonly errorCode?: string;
}

export interface McpResourceRef {
  readonly uri: string;
  readonly name: string;
  readonly description?: string;
  readonly mimeType?: string;
}

export interface McpResourceTemplateRef {
  readonly uriTemplate: string;
  readonly name: string;
  readonly description?: string;
  readonly mimeType?: string;
}

export interface McpPromptRef {
  readonly name: string;
  readonly description?: string;
  readonly arguments: readonly { readonly name: string; readonly description?: string; readonly required?: boolean }[];
}


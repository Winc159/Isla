import { Client, type CallToolResult } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/client/stdio';

export interface McpStdioClientOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly connectTimeoutMs?: number;
}

export interface McpListedTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations?: Record<string, unknown>;
}

export interface McpStdioClient {
  readonly client: Client;
  readonly transport: StdioClientTransport;
  connect(signal?: AbortSignal): Promise<void>;
  listTools(signal?: AbortSignal): Promise<readonly McpListedTool[]>;
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<CallToolResult>;
  close(): Promise<void>;
}

function abortError(): Error {
  return new DOMException('MCP operation cancelled', 'AbortError');
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => { signal.removeEventListener('abort', onAbort); reject(abortError()); };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', onAbort); resolve(value); }, error => { signal.removeEventListener('abort', onAbort); reject(error); });
  });
}

export function createMcpStdioClient(options: McpStdioClientOptions): McpStdioClient {
  const inherited = getDefaultEnvironment();
  const env = Object.fromEntries(Object.entries(inherited).filter(([key]) => !/(TOKEN|SECRET|PASSWORD|API[_-]?KEY|COOKIE|AUTH)/i.test(key) && !key.startsWith('ISLA_')));
  const server: StdioServerParameters = {
    command: options.command,
    ...(options.args ? { args: [...options.args] } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
    env: { ...env, ...(options.env ?? {}) },
    stderr: 'pipe',
  };
  const transport = new StdioClientTransport(server);
  const client = new Client({ name: 'isla', version: '0.4.0' }, { versionNegotiation: { mode: 'auto' } });
  const connect = (signal?: AbortSignal) => withAbort(client.connect(transport), signal);
  const listTools = async (signal?: AbortSignal): Promise<readonly McpListedTool[]> => {
    const result = await withAbort(client.listTools(), signal);
    return result.tools.map(tool => ({
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      inputSchema: tool.inputSchema as Record<string, unknown>,
      ...(tool.annotations ? { annotations: tool.annotations as Record<string, unknown> } : {}),
    }));
  };
  const callTool = (name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<CallToolResult> => withAbort(client.callTool({ name, arguments: args }), signal);
  return { client, transport, connect, listTools, callTool, close: () => client.close() };
}

import { Client, StreamableHTTPClientTransport, type CallToolResult, type ElicitRequestFormParams, type ElicitResult, type FetchLike, type OAuthClientProvider, type ReadResourceResult, type GetPromptResult, type Resource, type ResourceTemplateType, type Prompt } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/client/stdio';
import type { UserQuestion, UserQuestionService } from '../user-questions/types.js';
import { MCP_MAX_SCHEMA_BYTES } from './types.js';

export interface McpStdioClientOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly connectTimeoutMs?: number;
  readonly onListChanged?: (kind: 'tools' | 'resources' | 'prompts') => void;
  readonly elicitationContext?: () => { readonly service: UserQuestionService | undefined; readonly signal?: AbortSignal };
}

export interface McpListedTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations?: Record<string, unknown>;
}

export interface McpStdioClient extends McpClient {
  readonly client: Client;
  readonly transport: StdioClientTransport;
  connect(signal?: AbortSignal): Promise<void>;
  listTools(signal?: AbortSignal): Promise<readonly McpListedTool[]>;
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<CallToolResult>;
  close(): Promise<void>;
}

export interface McpClient {
  connect(signal?: AbortSignal): Promise<void>;
  listTools(signal?: AbortSignal): Promise<readonly McpListedTool[]>;
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<CallToolResult>;
  listResources(signal?: AbortSignal): Promise<readonly Resource[]>;
  listResourceTemplates(signal?: AbortSignal): Promise<readonly ResourceTemplateType[]>;
  readResource(uri: string, signal?: AbortSignal): Promise<ReadResourceResult>;
  listPrompts(signal?: AbortSignal): Promise<readonly Prompt[]>;
  getPrompt(name: string, args: Record<string, string>, signal?: AbortSignal): Promise<GetPromptResult>;
  authorizationUrl?(): string | undefined;
  finishAuthorization?(params: URLSearchParams): Promise<void>;
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
  const client = createClient(options);
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
  const call = <T>(operation: () => Promise<T>, signal?: AbortSignal) => withAbort(operation(), signal);
  return { client, transport, connect, listTools, callTool, listResources: signal => call(() => client.listResources(), signal).then(result => result.resources), listResourceTemplates: signal => call(() => client.listResourceTemplates(), signal).then(result => result.resourceTemplates), readResource: (uri, signal) => call(() => client.readResource({ uri }), signal), listPrompts: signal => call(() => client.listPrompts(), signal).then(result => result.prompts), getPrompt: (name, args, signal) => call(() => client.getPrompt({ name, arguments: args }), signal), close: () => client.close() };
}

export interface McpHttpClientOptions {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: FetchLike;
  readonly oauthProvider?: OAuthClientProvider & { authorizationUrl(): string | undefined; validateCallback(params: URLSearchParams): void; clearAuthorization(): Promise<void> };
  readonly onListChanged?: (kind: 'tools' | 'resources' | 'prompts') => void;
  readonly elicitationContext?: () => { readonly service: UserQuestionService | undefined; readonly signal?: AbortSignal };
}

export function createMcpHttpClient(options: McpHttpClientOptions): McpClient {
  const url = new URL(options.url);
  const createTransport = () => new StreamableHTTPClientTransport(url, {
    ...(options.headers && Object.keys(options.headers).length ? { requestInit: { headers: { ...options.headers } } } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.oauthProvider ? { authProvider: options.oauthProvider } : {}),
    redirectPolicy: 'same-origin',
  });
  let transport = createTransport();
  let client = createClient({ ...options, enforceStrictCapabilities: true });
  const connect = (signal?: AbortSignal) => withAbort(client.connect(transport), signal);
  const call = <T>(operation: () => Promise<T>, signal?: AbortSignal) => withAbort(operation(), signal);
  return {
    connect,
    listTools: signal => call(() => client.listTools(), signal).then(result => result.tools.map(tool => ({ name: tool.name, ...(tool.description ? { description: tool.description } : {}), inputSchema: tool.inputSchema as Record<string, unknown>, ...(tool.annotations ? { annotations: tool.annotations as Record<string, unknown> } : {}) }))),
    callTool: (name, args, signal) => call(() => client.callTool({ name, arguments: args }), signal),
    listResources: signal => call(() => client.listResources(), signal).then(result => result.resources),
    listResourceTemplates: signal => call(() => client.listResourceTemplates(), signal).then(result => result.resourceTemplates),
    readResource: (uri, signal) => call(() => client.readResource({ uri }), signal),
    listPrompts: signal => call(() => client.listPrompts(), signal).then(result => result.prompts),
    getPrompt: (name, args, signal) => call(() => client.getPrompt({ name, arguments: args }), signal),
    ...(options.oauthProvider ? {
      authorizationUrl: () => options.oauthProvider!.authorizationUrl(),
      finishAuthorization: async (params: URLSearchParams) => {
        options.oauthProvider!.validateCallback(params);
        await transport.finishAuth(params);
        await options.oauthProvider!.clearAuthorization();
        await client.close().catch(() => undefined);
        transport = createTransport();
        client = createClient({ ...options, enforceStrictCapabilities: true });
        await client.connect(transport);
      },
    } : {}),
    close: () => client.close(),
  };
}

function listChangedHandlers(onChanged: McpHttpClientOptions['onListChanged']): NonNullable<import('@modelcontextprotocol/client').ClientOptions['listChanged']> {
  return {
    tools: { onChanged: () => onChanged?.('tools') },
    resources: { onChanged: () => onChanged?.('resources') },
    prompts: { onChanged: () => onChanged?.('prompts') },
  };
}

function createClient(options: Pick<McpStdioClientOptions, 'onListChanged' | 'elicitationContext'> & { readonly enforceStrictCapabilities?: boolean }): Client {
  const client = new Client({ name: 'isla', version: '0.8.2' }, { versionNegotiation: { mode: 'auto' }, ...(options.enforceStrictCapabilities ? { enforceStrictCapabilities: true } : {}), listMaxPages: 16, listChanged: listChangedHandlers(options.onListChanged) });
  client.registerCapabilities({ elicitation: { form: {} } });
  client.setRequestHandler('elicitation/create', async request => request.params.mode === 'url' ? { action: 'decline' } : handleFormElicitation(request.params as ElicitRequestFormParams, options.elicitationContext?.()));
  return client;
}

export async function handleFormElicitation(params: ElicitRequestFormParams, context: { readonly service: UserQuestionService | undefined; readonly signal?: AbortSignal } | undefined): Promise<ElicitResult> {
  if (!context?.service) return { action: 'decline' };
  const fields = Object.entries(params.requestedSchema.properties);
  if (!fields.length || fields.length > 16 || Buffer.byteLength(JSON.stringify(params.requestedSchema), 'utf8') > MCP_MAX_SCHEMA_BYTES || params.message.length > 8_192) return { action: 'decline' };
  const questions: UserQuestion[] = [];
  const fieldById = new Map<string, { readonly name: string; readonly schema: Record<string, unknown>; readonly required: boolean }>();
  for (const [index, [name, rawSchema]] of fields.entries()) {
    if (name.length > 128 || !isRecord(rawSchema)) return { action: 'decline' };
    const question = questionForField(index, name, rawSchema);
    if (!question) return { action: 'decline' };
    questions.push(question);
    fieldById.set(question.id, { name, schema: rawSchema, required: params.requestedSchema.required?.includes(name) === true });
  }
  const asked = questions.map((question, index) => index === 0 ? { ...question, question: `${params.message.slice(0, 2_000)}\n${question.question}` } : question);
  const result = await context.service.ask({ questions: asked }, { ...(context.signal ? { signal: context.signal } : {}) });
  if (result.answers.length !== fieldById.size || new Set(result.answers.map(answer => answer.id)).size !== fieldById.size) return { action: 'decline' };
  const content: Record<string, string | number | boolean | string[]> = {};
  for (const answer of result.answers) {
    const field = fieldById.get(answer.id);
    if (!field) return { action: 'decline' };
    const value = parseFieldAnswer(field.schema, answer, field.required);
    if (value === INVALID_FIELD) return { action: 'decline' };
    if (value !== OMIT_FIELD) content[field.name] = value;
  }
  return { action: 'accept', content };
}

const INVALID_FIELD = Symbol('invalid-field');
const OMIT_FIELD = Symbol('omit-field');

function questionForField(index: number, name: string, schema: Record<string, unknown>): UserQuestion | undefined {
  const id = `mcp-field-${index}`;
  const label = typeof schema.title === 'string' ? schema.title.slice(0, 80) : name.slice(0, 80);
  const description = typeof schema.description === 'string' ? schema.description.slice(0, 500) : undefined;
  if (Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.length <= 32 && schema.enum.every(value => typeof value === 'string' && value.length <= 200)) return { id, header: label, question: description ?? '请选择一个值。', options: schema.enum.map(value => ({ label: value as string })) };
  if (schema.type === 'string' && typeof schema.pattern !== 'string' && typeof schema.format !== 'string') return { id, header: label, question: description ?? '请输入文本。' };
  if (schema.type === 'number' || schema.type === 'integer') return { id, header: label, question: `${description ?? '请输入数字。'}${typeof schema.minimum === 'number' ? ` 最小值 ${schema.minimum}。` : ''}${typeof schema.maximum === 'number' ? ` 最大值 ${schema.maximum}。` : ''}` };
  if (schema.type === 'boolean') return { id, header: label, question: description ?? '请选择 true 或 false。', options: [{ label: 'true' }, { label: 'false' }] };
  if (schema.type === 'array' && schema.uniqueItems !== true && isRecord(schema.items) && Array.isArray(schema.items.enum) && schema.items.enum.length > 0 && schema.items.enum.length <= 32 && schema.items.enum.every(value => typeof value === 'string' && value.length <= 200)) return { id, header: label, question: description ?? '请选择一个或多个值。', options: schema.items.enum.map(value => ({ label: value as string })), multiSelect: true };
  return undefined;
}

function parseFieldAnswer(schema: Record<string, unknown>, answer: { readonly selected: readonly string[]; readonly custom?: string }, required: boolean): string | number | boolean | string[] | typeof INVALID_FIELD | typeof OMIT_FIELD {
  const raw = answer.selected.length ? (schema.type === 'array' ? answer.selected : answer.selected[0]) : answer.custom;
  if (raw === undefined || raw === '') return required ? INVALID_FIELD : OMIT_FIELD;
  if (Array.isArray(schema.enum)) return typeof raw === 'string' && schema.enum.includes(raw) ? raw : INVALID_FIELD;
  if (schema.type === 'string') return typeof raw === 'string' && raw.length <= 4096 && (typeof schema.minLength !== 'number' || raw.length >= schema.minLength) && (typeof schema.maxLength !== 'number' || raw.length <= schema.maxLength) ? raw : INVALID_FIELD;
  if (schema.type === 'boolean') return raw === 'true' ? true : raw === 'false' ? false : INVALID_FIELD;
  if (schema.type === 'number' || schema.type === 'integer') {
    const parsed = typeof raw === 'string' && raw.trim() ? Number(raw) : Number.NaN;
    if (!Number.isFinite(parsed) || schema.type === 'integer' && !Number.isInteger(parsed) || typeof schema.minimum === 'number' && parsed < schema.minimum || typeof schema.maximum === 'number' && parsed > schema.maximum) return INVALID_FIELD;
    return parsed;
  }
  if (schema.type === 'array' && isRecord(schema.items) && Array.isArray(schema.items.enum)) { const choices = schema.items.enum; return answer.selected.length && answer.selected.every(value => choices.includes(value)) && (typeof schema.minItems !== 'number' || answer.selected.length >= schema.minItems) && (typeof schema.maxItems !== 'number' || answer.selected.length <= schema.maxItems) ? [...answer.selected] : INVALID_FIELD; }
  return INVALID_FIELD;
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

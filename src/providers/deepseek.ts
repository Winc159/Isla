import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import type { RuntimePlugin } from '../core/plugin.js';
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ToolResponse,
  ToolDefinition,
} from '../core/types.js';
import type { DeepSeekConfig } from '../config.js';
import { normalizeProviderError, RuntimeError } from '../core/errors.js';
export function createDeepSeekPlugin(config: DeepSeekConfig): RuntimePlugin {
  return {
    name: 'deepseek',
    setup: (c) => c.registerProvider(new DeepSeekProvider(config)),
  };
}
class DeepSeekProvider implements ModelProvider {
  readonly id = 'deepseek';
  readonly model: string;
  private readonly client: OpenAI;
  constructor(config: DeepSeekConfig) {
    this.model = config.model;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: 'https://api.deepseek.com',
      timeout: config.timeoutMs,
      maxRetries: 0,
    });
  }
  async generate(request: ModelRequest): Promise<ModelResponse> {
    const body = {
      model: this.model,
      messages: request.messages.map(toChatMessage),
      thinking: { type: 'disabled' as const },
    };
    try {
    const r = await this.client.chat.completions.create(body as never);
    const text = r.choices[0]?.message.content;
    if (!text?.trim()) throw new RuntimeError({ code: 'PROVIDER_EMPTY_RESPONSE', recoverable: false, message: 'DeepSeek 模型返回了空回答。' });
    return {
      text,
      model: r.model,
      ...(r.usage
        ? {
            usage: {
              input: r.usage.prompt_tokens,
              output: r.usage.completion_tokens,
              total: r.usage.total_tokens,
            },
          }
        : {}),
    };
    } catch (error) { throw normalizeProviderError(error, 'DeepSeek'); }
  }
  async generateWithTools(request: ModelRequest): Promise<ToolResponse> {
    try {
    const r = await this.client.chat.completions.create({
      model: this.model,
      messages: request.messages.map(toChatMessage) as never,
      ...(request.tools ? { tools: request.tools.map(toChatTool) } : {}),
      ...(request.toolChoice ? { tool_choice: request.toolChoice === 'auto' || request.toolChoice === 'required' ? request.toolChoice : { type: 'function', function: { name: request.toolChoice.name } } } : {}),
      thinking: { type: 'disabled' as const },
    } as never);
    const message = r.choices[0]?.message as { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } | undefined;
    const structuredCalls = message?.tool_calls?.map(call => ({ id: call.id, name: call.function.name ?? '', arguments: call.function.arguments })) ?? [];
    const textCalls = parseDsmlToolCalls(message?.content ?? '');
    const toolCalls = [...structuredCalls, ...textCalls];
    if (!toolCalls.length && !message?.content?.trim()) {
      throw new RuntimeError({ code: 'PROVIDER_EMPTY_RESPONSE', recoverable: false, message: 'DeepSeek 模型返回了空回答。' });
    }
    return {
      text: textCalls.length ? '' : message?.content ?? '',
      model: r.model,
      ...(toolCalls.length ? { toolCalls } : {}),
    };
    } catch (error) { throw normalizeProviderError(error, 'DeepSeek'); }
  }
}
function toChatTool(tool: ToolDefinition) {
  return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } };
}
function toChatMessage(message: ModelRequest['messages'][number]) {
  if (message.role === 'tool') return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  if (message.role === 'assistant' && message.toolCalls?.length) return { role: 'assistant', content: message.content || null, tool_calls: message.toolCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) };
  return { role: message.role, content: message.content };
}
export function parseDsmlToolCalls(content: string) {
  const calls: Array<{ id: string; name: string; arguments: string }> = [];
  const invokePattern = /<[^>]*invoke\b[^>]*\bname=["']([^"']+)["'][^>]*>([\s\S]*?)<\/[^>]*invoke\s*>/gi;
  for (const invoke of content.matchAll(invokePattern)) {
    const rawName = invoke[1];
    const body = invoke[2];
    if (!rawName || body === undefined) continue;
    const parameters: Record<string, string> = {};
    const parameterPattern = /<[^>]*parameter\b[^>]*\bname=["']([^"']+)["'][^>]*>([\s\S]*?)<\/[^>]*parameter\s*>/gi;
    for (const parameter of body.matchAll(parameterPattern)) {
      const name = parameter[1];
      const value = parameter[2];
      if (name && value !== undefined) parameters[name] = decodeXml(value.trim());
    }
    calls.push({
      id: `dsml-${randomUUID()}`,
      name: rawName === 'read_file' ? 'read_text_file' : rawName,
      arguments: JSON.stringify(parameters),
    });
  }
  return calls;
}

function decodeXml(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

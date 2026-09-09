import OpenAI from 'openai';
import type { RuntimePlugin } from '../core/plugin.js';
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ToolResponse,
  ToolDefinition,
} from '../core/types.js';
import type { DeepSeekConfig } from '../config.js';
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
    const r = await this.client.chat.completions.create(body as never);
    const text = r.choices[0]?.message.content;
    if (!text?.trim()) throw new Error('DeepSeek returned no text');
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
  }
  async generateWithTools(request: ModelRequest): Promise<ToolResponse> {
    const r = await this.client.chat.completions.create({
      model: this.model,
      messages: request.messages.map(toChatMessage) as never,
      ...(request.tools ? { tools: request.tools.map(toChatTool) } : {}),
      ...(request.toolChoice ? { tool_choice: request.toolChoice === 'auto' || request.toolChoice === 'required' ? request.toolChoice : { type: 'function', function: { name: request.toolChoice.name } } } : {}),
      thinking: { type: 'disabled' as const },
    } as never);
    const message = r.choices[0]?.message as { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } | undefined;
    const structuredCalls = message?.tool_calls?.map(call => ({ id: call.id, name: call.function.name ?? '', arguments: call.function.arguments })) ?? [];
    const textCall = parseDsmlToolCall(message?.content ?? '');
    return {
      text: textCall ? '' : message?.content ?? '',
      model: r.model,
      ...((structuredCalls.length || textCall) ? { toolCalls: textCall ? [textCall] : structuredCalls } : {}),
    };
  }
  async *generateStream(request: ModelRequest): AsyncIterable<{ text: string }> {
    const stream = await this.client.chat.completions.create({
      model: this.model, messages: request.messages.map(toChatMessage), thinking: { type: 'disabled' }, stream: true,
    } as never) as unknown as AsyncIterable<{ choices?: Array<{ delta?: { content?: string | null } }> }>;
    for await (const chunk of stream) {
      const text = chunk.choices?.[0]?.delta?.content;
      if (text) yield { text };
    }
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
function parseDsmlToolCall(content: string) {
  const match = content.match(/invoke\s+name="([^"]+)"[\s\S]*?<[^>]*parameter\s+name="path"[^>]*>([\s\S]*?)<\/[^>]*parameter>/);
  if (!match) return undefined;
  const rawName = match[1];
  const path = match[2];
  if (!rawName || path === undefined) return undefined;
  const name = rawName === 'read_file' ? 'read_text_file' : rawName;
  return { id: `dsml-${Date.now()}`, name, arguments: JSON.stringify({ path: path.trim() }) };
}

import OpenAI from 'openai';
import type { RuntimePlugin } from '../core/plugin.js';
import type { ModelCallOptions, ModelProvider, ModelRequest, ModelResponse, ProviderCapabilities, ToolResponse, ToolDefinition, TokenUsage } from '../core/types.js';
import type { ModelStreamEvent } from '../core/model-stream.js';
import type { BailianConfig } from '../config.js';
import { normalizeProviderError, RuntimeError } from '../core/errors.js';
import { bailianCapabilities } from './bailian-capabilities.js';

export function createBailianPlugin(config: BailianConfig): RuntimePlugin {
  return { name: 'bailian', setup: context => context.registerProvider(new BailianProvider(config)) };
}

class BailianProvider implements ModelProvider {
  readonly id = 'bailian';
  readonly model: string;
  readonly streamingEnabled: boolean;
  readonly capabilities: ProviderCapabilities;
  private readonly client: OpenAI;

  constructor(config: BailianConfig) {
    this.model = config.model;
    this.streamingEnabled = config.streaming === true;
    this.capabilities = bailianCapabilities(this.model, this.streamingEnabled);
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, timeout: config.timeoutMs, maxRetries: 0 });
  }

  async generate(request: ModelRequest, options?: ModelCallOptions): Promise<ModelResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: request.messages.map(message => ({ role: message.role, content: message.content })) as never,
        stream: false,
        ...(request.maxCompletionTokens ? { max_completion_tokens: request.maxCompletionTokens } : {}),
      }, options?.signal ? { signal: options.signal } : undefined);
      const text = response.choices[0]?.message.content;
      if (!text?.trim()) throw new RuntimeError({ code: 'PROVIDER_EMPTY_RESPONSE', recoverable: false, message: '百炼模型返回了空回答。' });
      return {
        text,
        model: response.model,
        ...(response.usage ? { usage: { input: response.usage.prompt_tokens, output: response.usage.completion_tokens, total: response.usage.total_tokens } } : {}),
      };
    } catch (error) {
      throw normalizeProviderError(error, 'Bailian');
    }
  }

  async generateWithTools(request: ModelRequest, options?: ModelCallOptions): Promise<ToolResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: request.messages.map(message => toChatMessage(message)) as never,
        ...(request.tools ? { tools: request.tools.map(toChatTool) } : {}),
        ...(request.toolChoice ? { tool_choice: request.toolChoice === 'auto' || request.toolChoice === 'required' ? request.toolChoice : { type: 'function', function: { name: request.toolChoice.name } } } : {}),
        stream: false,
        ...(request.maxCompletionTokens ? { max_completion_tokens: request.maxCompletionTokens } : {}),
      } as never, options?.signal ? { signal: options.signal } : undefined);
      const message = response.choices[0]?.message as { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } | undefined;
      const toolCalls = message?.tool_calls?.map(call => ({ id: call.id ?? '', name: call.function?.name ?? '', arguments: call.function?.arguments ?? '' })) ?? [];
      if (!toolCalls.length && !message?.content?.trim()) throw new RuntimeError({ code: 'PROVIDER_EMPTY_RESPONSE', recoverable: false, message: '百炼模型返回了空回答。' });
      return { text: message?.content ?? '', model: response.model, ...(toolCalls.length ? { toolCalls } : {}) };
    } catch (error) { throw normalizeProviderError(error, 'Bailian'); }
  }

  generateStream(request: ModelRequest, options?: ModelCallOptions): AsyncIterable<ModelStreamEvent> { return this.stream(request, options); }

  private async *stream(request: ModelRequest, options?: ModelCallOptions): AsyncIterable<ModelStreamEvent> {
    try {
      const response = await this.client.chat.completions.create({ model: this.model, messages: request.messages.map(message => toChatMessage(message)) as never, stream: true, ...(request.maxCompletionTokens ? { max_completion_tokens: request.maxCompletionTokens } : {}) } as never, options?.signal ? { signal: options.signal } : undefined) as unknown as AsyncIterable<{ readonly choices: readonly { readonly delta?: unknown; readonly finish_reason?: string | null }[]; readonly model: string; readonly usage?: { readonly prompt_tokens: number; readonly completion_tokens: number; readonly total_tokens: number } | null }>;
      for await (const chunk of response) {
        const choice = chunk.choices[0];
        const delta = choice?.delta as { content?: string | null; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> } | undefined;
        if (delta?.content) yield { type: 'text_delta', index: 0, delta: delta.content };
        for (const call of delta?.tool_calls ?? []) yield { type: 'tool_call_delta', index: call.index ?? 0, ...(call.id ? { id: call.id } : {}), ...(call.function?.name ? { name: call.function.name } : {}), argumentsDelta: call.function?.arguments ?? '' };
        if (chunk.usage) yield { type: 'usage', usage: { input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens, total: chunk.usage.total_tokens } satisfies TokenUsage };
        if (choice?.finish_reason) yield { type: 'finish', reason: choice.finish_reason === 'length' ? 'max_tokens' : choice.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop', model: chunk.model, ...(choice.finish_reason === 'length' ? { error: { code: 'PROVIDER_INVALID_RESPONSE', recoverable: false, message: '百炼模型输出未完整结束。' } } : {}) };
      }
    } catch (error) { throw normalizeProviderError(error, 'Bailian'); }
  }
}

function toChatTool(tool: ToolDefinition) { return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }; }
function toChatMessage(message: ModelRequest['messages'][number]) {
  if (message.role === 'tool') return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  if (message.role === 'assistant' && message.toolCalls?.length) return { role: 'assistant', content: message.content || null, tool_calls: message.toolCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) };
  return { role: message.role, content: message.content };
}

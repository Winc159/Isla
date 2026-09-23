import type { Message, ModelRequest, ToolDefinition } from './types.js';

export const DEFAULT_MAX_CONTEXT_TOKENS = 16_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 2_048;
export const DEFAULT_CONTEXT_RESERVE_TOKENS = 512;

export interface TokenBudgetPolicy {
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly reserveTokens: number;
  readonly source: 'profile' | 'fallback';
}

export function estimateTextTokens(text: string): number {
  return Math.max(Math.ceil(text.length / 2), Math.ceil(Buffer.byteLength(text, 'utf8') / 3));
}

export function estimateMessageTokens(message: Message): number {
  let total = estimateTextTokens(message.content) + 8;
  if (message.toolCallId) total += estimateTextTokens(message.toolCallId) + 8;
  for (const call of message.toolCalls ?? []) total += estimateTextTokens(call.id) + estimateTextTokens(call.name) + estimateTextTokens(call.arguments) + 16;
  return total;
}

export function estimateToolTokens(tool: ToolDefinition): number { return estimateTextTokens(JSON.stringify(tool)) + 16; }

export function estimateRequestTokens(request: ModelRequest): number {
  return request.messages.reduce((total, message) => total + estimateMessageTokens(message), 0)
    + (request.tools ?? []).reduce((total, tool) => total + estimateToolTokens(tool), 0)
    + (request.responseFormat ? 16 : 0);
}

export function resolveTokenBudget(options: { readonly maxContextTokens?: number; readonly maxOutputTokens?: number; readonly contextReserveTokens?: number }): TokenBudgetPolicy {
  const maxInputTokens = options.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS;
  const maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const reserveTokens = options.contextReserveTokens ?? DEFAULT_CONTEXT_RESERVE_TOKENS;
  for (const [name, value] of Object.entries({ maxInputTokens, maxOutputTokens, reserveTokens })) if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return { maxInputTokens, maxOutputTokens, reserveTokens, source: options.maxContextTokens || options.maxOutputTokens || options.contextReserveTokens ? 'profile' : 'fallback' };
}

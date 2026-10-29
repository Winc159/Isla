import type { Message, ToolDefinition } from './types.js';
import { estimateRequestTokens } from './token-budget.js';
import { detectResearchIntent, researchCapabilityGap } from './research-policy.js';

export interface AgentLoopPreflightInput { readonly messages: readonly Message[]; readonly tools: readonly ToolDefinition[]; readonly maxInputTokens: number; }
export interface AgentLoopPreflightResult {
  readonly messages: readonly Message[];
  readonly researchGap?: string;
  readonly researchRequired: boolean;
  readonly trimmed: boolean;
}
export function preflightAgentLoop(input: AgentLoopPreflightInput): AgentLoopPreflightResult {
  const latest = [...input.messages].reverse().find(message => message.role === 'user')?.content ?? '';
  const intent = detectResearchIntent(latest);
  const gap = researchCapabilityGap(intent, input.tools);
  if (gap) return { messages: input.messages, researchGap: gap, researchRequired: intent.required, trimmed: false };
  if (estimateRequestTokens({ messages: input.messages, tools: input.tools }) <= input.maxInputTokens) return { messages: input.messages, researchRequired: intent.required, trimmed: false };
  const systemMessages = input.messages.filter(message => message.role === 'system');
  // Keep the current runtime-owned execution contract when old history is
  // trimmed. Losing this message can make an approved Act Plan invisible to
  // the model even though the Runtime still enforces it.
  const stable = [...new Set([
    ...systemMessages.slice(0, 4),
    ...systemMessages.filter(message => /^(?:当前工作模式=|当前任务状态|当前工作区验证状态)/u.test(message.content)),
  ])];
  let dynamic = input.messages.filter(message => message.role !== 'system');
  while (dynamic.length > 1 && estimateRequestTokens({ messages: [...stable, ...dynamic], tools: input.tools }) > input.maxInputTokens) dynamic = dynamic.slice(1);
  return { messages: [...stable, ...dynamic], researchRequired: intent.required, trimmed: true };
}

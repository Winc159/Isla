import type { Message, ModelProvider, ModelRequest } from './types.js';
import { parseTurnDecision, type TurnDecision } from './agent-loop.js';

export const DECISION_PHASE_PROMPT = '先判断本轮意图，只输出 JSON：answer（简单回答）、clarify（缺少关键条件）或 execute（需要工具/多步任务）。execute 必须给出 objective 和 evidenceRequirement；不要输出思维过程。';

export interface DecisionPhaseResult {
  readonly decision: TurnDecision;
  readonly repaired: boolean;
}

export async function runDecisionPhase(provider: ModelProvider, history: readonly Message[], options: { readonly signal?: AbortSignal } = {}): Promise<DecisionPhaseResult> {
  const request: ModelRequest = { messages: [{ role: 'system', content: DECISION_PHASE_PROMPT }, ...history], responseFormat: { type: 'json_object' } };
  const first = await provider.generate(request, options);
  try { return { decision: parseTurnDecision(first.text, history), repaired: false }; }
  catch (error) {
    const repair = await provider.generate({ ...request, messages: [...request.messages, { role: 'assistant', content: first.text }, { role: 'user', content: `只修复 JSON 格式，保留原意。错误：${error instanceof Error ? error.message : 'invalid decision'}` }] }, options);
    return { decision: parseTurnDecision(repair.text, history), repaired: true };
  }
}

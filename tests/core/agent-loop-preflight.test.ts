import { describe, expect, it } from 'vitest';
import { preflightAgentLoop } from '../../src/core/agent-loop-preflight.js';
describe('agent loop preflight', () => {
  it('returns a capability gap before the loop starts', () => expect(preflightAgentLoop({ messages: [{ role: 'user', content: '搜索网上公开资料' }], tools: [{ name: 'browser_open', description: '', parameters: {} }], maxInputTokens: 1000 }).researchGap).toContain('Web Search'));
  it('trims oversized history while preserving policy and latest message', () => {
    const messages = [{ role: 'system' as const, content: 'policy' }, ...Array.from({ length: 30 }, (_, index) => ({ role: 'user' as const, content: `${index}-`.repeat(500) })), { role: 'user' as const, content: 'latest' }];
    const result = preflightAgentLoop({ messages, tools: [], maxInputTokens: 500 });
    expect(result.trimmed).toBe(true); expect(result.messages[0]).toMatchObject({ content: 'policy' }); expect(result.messages.at(-1)).toMatchObject({ content: 'latest' });
  });
});

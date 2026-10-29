import { describe, expect, it } from 'vitest';
import { preflightAgentLoop } from '../../src/core/agent-loop-preflight.js';
describe('agent loop preflight', () => {
  it('returns a capability gap before the loop starts', () => expect(preflightAgentLoop({ messages: [{ role: 'user', content: '搜索网上公开资料' }], tools: [{ name: 'browser_open', description: '', parameters: {} }], maxInputTokens: 1000 }).researchGap).toContain('Web Search'));
  it('trims oversized history while preserving policy and latest message', () => {
    const messages = [{ role: 'system' as const, content: 'policy' }, ...Array.from({ length: 30 }, (_, index) => ({ role: 'user' as const, content: `${index}-`.repeat(500) })), { role: 'user' as const, content: 'latest' }];
    const result = preflightAgentLoop({ messages, tools: [], maxInputTokens: 500 });
    expect(result.trimmed).toBe(true); expect(result.messages[0]).toMatchObject({ content: 'policy' }); expect(result.messages.at(-1)).toMatchObject({ content: 'latest' });
  });
  it('preserves the current approved work contract when trimming oversized history', () => {
    const contract = { role: 'system' as const, content: '当前工作模式=act。当前 Plan：{"revision":1,"approvedRevision":1,"goal":"修复模块"}' };
    const messages = [
      { role: 'system' as const, content: 'runtime policy' },
      ...Array.from({ length: 30 }, (_, index) => ({ role: 'user' as const, content: `${index}-`.repeat(500) })),
      contract,
      { role: 'user' as const, content: '继续执行已批准计划' },
    ];
    const result = preflightAgentLoop({ messages, tools: [], maxInputTokens: 500 });
    expect(result.trimmed).toBe(true);
    expect(result.messages).toContainEqual(contract);
    expect(result.messages.at(-1)).toMatchObject({ content: '继续执行已批准计划' });
  });
});

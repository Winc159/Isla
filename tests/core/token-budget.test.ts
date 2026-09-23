import { describe, expect, it } from 'vitest';
import { estimateRequestTokens, estimateTextTokens, resolveTokenBudget } from '../../src/core/token-budget.js';

describe('token budget', () => {
  it('uses a deterministic conservative estimate for multilingual text', () => {
    expect(estimateTextTokens('hello')).toBe(3);
    expect(estimateTextTokens('你好世界')).toBe(4);
    expect(estimateTextTokens('')).toBe(0);
  });

  it('counts messages and tool schemas', () => {
    const plain = estimateRequestTokens({ messages: [{ role: 'user', content: '读取文件' }] });
    const withTool = estimateRequestTokens({ messages: [{ role: 'user', content: '读取文件' }], tools: [{ name: 'read', description: 'read', parameters: { type: 'object', properties: { path: { type: 'string' } } } }] });
    expect(withTool).toBeGreaterThan(plain);
  });

  it('validates and resolves profile budgets', () => {
    expect(resolveTokenBudget({ maxContextTokens: 1000, maxOutputTokens: 200, contextReserveTokens: 50 })).toMatchObject({ maxInputTokens: 1000, maxOutputTokens: 200, reserveTokens: 50, source: 'profile' });
    expect(resolveTokenBudget({})).toMatchObject({ maxInputTokens: 16000, maxOutputTokens: 2048, reserveTokens: 512, source: 'fallback' });
    expect(() => resolveTokenBudget({ maxContextTokens: 0 })).toThrow('maxInputTokens');
  });
});

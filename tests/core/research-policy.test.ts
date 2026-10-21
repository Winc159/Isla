import { describe, expect, it } from 'vitest';
import { detectResearchIntent, researchCapabilityGap } from '../../src/core/research-policy.js';

describe('research policy', () => {
  it('distinguishes public search from explicit URL reading', () => {
    expect(detectResearchIntent('搜索网上公开资料')).toMatchObject({ required: true, publicSearchWithoutUrl: true, explicitUrl: false });
    expect(detectResearchIntent('打开 https://example.com 并读取页面')).toMatchObject({ explicitUrl: true, publicSearchWithoutUrl: false });
  });
  it('fails closed for public search without Search capability', () => {
    expect(researchCapabilityGap(detectResearchIntent('请搜索网上公开资料'), [{ name: 'browser_open', description: '', parameters: {} }])).toContain('Web Search');
    expect(researchCapabilityGap(detectResearchIntent('请打开 https://example.com'), [{ name: 'browser_open', description: '', parameters: {} }])).toBeUndefined();
  });
});

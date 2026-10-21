import { describe, expect, it } from 'vitest';
import { RUNTIME_POLICY_PROMPT } from '../../src/prompts/base.js';

describe('runtime policy', () => {
  it('guides focused evidence-first environment investigations', () => {
    expect(RUNTIME_POLICY_PROMPT).toContain('环境/代理/联网/工具限制');
    expect(RUNTIME_POLICY_PROMPT).toContain('配置/Profile 入口');
    expect(RUNTIME_POLICY_PROMPT).toContain('连续两次只读观察');
  });
});

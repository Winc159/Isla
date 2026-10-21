import type { ToolDefinition } from './types.js';

export interface ResearchIntent { readonly required: boolean; readonly publicSearchWithoutUrl: boolean; readonly explicitUrl: boolean; }
export function detectResearchIntent(input: string): ResearchIntent {
  const required = /(?:查找|搜索|查询|参考|核实).{0,12}(?:网上|网络|公开资料|公开来源)|(?:网上|网络|公开资料|公开来源).{0,12}(?:查找|搜索|查询|参考|核实)|\b(?:search|research|look up|verify)\b.{0,24}\b(?:web|online|public sources?)\b/iu.test(input);
  const explicitUrl = /https?:\/\//iu.test(input);
  return { required, explicitUrl, publicSearchWithoutUrl: required && !explicitUrl && /(?:网上|网络|公开资料|公开来源|web|online|public sources?)/iu.test(input) };
}
export function researchCapabilityGap(intent: ResearchIntent, tools: readonly ToolDefinition[]): string | undefined {
  if (intent.publicSearchWithoutUrl && !tools.some(tool => tool.name === 'web_search')) return '当前 Profile 没有可用的外部来源发现能力：Web Search 未配置。可以继续基于本地项目事实回答，但不能声称已联网核实。';
  if (intent.required && !tools.some(tool => tool.name === 'web_search' || tool.name === 'browser_open')) return '当前 Profile 没有可用的外部来源发现能力（Web Search 或 Browser）。可以继续基于本地项目事实回答，但不能声称已联网核实。';
  return undefined;
}
export const RESEARCH_EVIDENCE_REMINDER = '该请求需要外部公开资料，但当前尚无成功来源证据。必须先使用 Web Search 或 Browser 查找并读取来源，不能用模型记忆冒充联网结果。';

import type { ProviderCapabilities } from '../core/types.js';

const VERIFIED_TOOL_MODELS = new Set(['qwen-plus', 'qwen3.7-plus']);

export function bailianCapabilities(model: string, streamingEnabled: boolean): ProviderCapabilities {
  return { toolCalling: VERIFIED_TOOL_MODELS.has(model), nativeStreaming: streamingEnabled, streamingToolCalls: false };
}

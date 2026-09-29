import type { ProviderCapabilities } from '../core/types.js';

export function bailianCapabilities(_model: string, streamingEnabled: boolean, catalogDecision?: boolean): ProviderCapabilities {
  return { toolCalling: catalogDecision ?? true, nativeStreaming: streamingEnabled, streamingToolCalls: false };
}

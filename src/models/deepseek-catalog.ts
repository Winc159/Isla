import type { ModelCallOptions } from '../core/types.js';
import { normalizeProviderError } from '../core/errors.js';
import type { ModelCatalogEntry } from './catalog.js';

export interface DeepSeekModelCatalogEntry extends ModelCatalogEntry {}

export async function listDeepSeekModels(apiKey: string, options?: ModelCallOptions): Promise<readonly DeepSeekModelCatalogEntry[]> {
  try {
    const response = await fetch('https://api.deepseek.com/models', {
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      ...(options?.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) throw new Error(`DeepSeek model catalog request failed: ${response.status}`);
    const body = await response.json() as { data?: unknown };
    if (!Array.isArray(body.data)) throw new Error('DeepSeek model catalog response is invalid');
    return body.data.map(projectModel);
  } catch (error) {
    throw normalizeProviderError(error, 'DeepSeek model catalog');
  }
}

function projectModel(raw: unknown): DeepSeekModelCatalogEntry {
  if (!raw || typeof raw !== 'object') throw new Error('DeepSeek model catalog entry is invalid');
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== 'string' || !value.id.trim()) throw new Error('DeepSeek model catalog entry has no model ID');
  return {
    id: value.id,
    ...(typeof value.owned_by === 'string' ? { owner: value.owned_by } : {}),
  };
}

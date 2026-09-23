import type { ModelCallOptions } from '../core/types.js';
import { normalizeProviderError } from '../core/errors.js';
import type { ModelCatalogEntry, ModelCatalogQuery } from './catalog.js';

export interface BailianModelCatalogEntry extends ModelCatalogEntry {
  readonly id: string;
  readonly name?: string;
  readonly provider?: string;
  readonly inferenceProvider?: string;
  readonly capabilities: readonly string[];
  readonly features: readonly string[];
  readonly contextWindow?: number;
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
  readonly maxReasoningTokens?: number;
}

export interface BailianModelCatalogQuery extends ModelCatalogQuery {
  readonly name?: string;
  readonly model?: string;
  readonly providers?: readonly string[];
  readonly capabilities?: readonly string[];
  readonly features?: readonly string[];
  readonly pageSize?: number;
  readonly maxPages?: number;
}

export async function listBailianModels(baseURL: string, apiKey: string, query: BailianModelCatalogQuery = {}, options?: ModelCallOptions): Promise<readonly BailianModelCatalogEntry[]> {
  const origin = new URL(baseURL);
  const url = new URL('/api/v1/models', origin.origin);
  const pageSize = query.pageSize ?? 100;
  const maxPages = query.maxPages ?? 20;
  const models: BailianModelCatalogEntry[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    url.search = '';
    url.searchParams.set('page_no', String(page));
    url.searchParams.set('page_size', String(pageSize));
    if (query.search) url.searchParams.set('name', query.search);
    if (query.name) url.searchParams.set('name', query.name);
    if (query.model) url.searchParams.set('model', query.model);
    for (const provider of query.providers ?? []) url.searchParams.append('providers', provider);
    for (const capability of query.capabilities ?? []) url.searchParams.append('capabilities', capability);
    for (const feature of query.features ?? []) url.searchParams.append('features', feature);
    try {
      const response = await fetch(url, { headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' }, ...(options?.signal ? { signal: options.signal } : {}) });
      if (!response.ok) throw new Error(`Bailian model catalog request failed: ${response.status}`);
      const body = await response.json() as { output?: { total?: number; models?: unknown[] } };
      const pageModels = body.output?.models;
      if (!Array.isArray(pageModels)) throw new Error('Bailian model catalog response is invalid');
      for (const raw of pageModels) models.push(projectModel(raw));
      if (models.length >= (body.output?.total ?? models.length) || pageModels.length === 0) break;
    } catch (error) {
      throw normalizeProviderError(error, 'Bailian model catalog');
    }
  }
  return models;
}

function projectModel(raw: unknown): BailianModelCatalogEntry {
  if (!raw || typeof raw !== 'object') throw new Error('Bailian model catalog entry is invalid');
  const value = raw as Record<string, unknown>;
  if (typeof value.model !== 'string' || !value.model.trim()) throw new Error('Bailian model catalog entry has no model ID');
  const info = value.model_info && typeof value.model_info === 'object' ? value.model_info as Record<string, unknown> : {};
  return {
    id: value.model,
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(typeof value.provider === 'string' ? { provider: value.provider } : {}),
    ...(typeof value.inference_provider === 'string' ? { inferenceProvider: value.inference_provider } : {}),
    capabilities: strings(value.capabilities),
    features: strings(value.features),
    ...(typeof info.context_window === 'number' ? { contextWindow: info.context_window } : {}),
    ...(typeof info.max_input_tokens === 'number' ? { maxInputTokens: info.max_input_tokens } : {}),
    ...(typeof info.max_output_tokens === 'number' ? { maxOutputTokens: info.max_output_tokens } : {}),
    ...(typeof info.max_reasoning_tokens === 'number' ? { maxReasoningTokens: info.max_reasoning_tokens } : {}),
  };
}

function strings(value: unknown): readonly string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }

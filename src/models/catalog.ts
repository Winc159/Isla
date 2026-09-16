import type { ModelCallOptions } from '../core/types.js';

export interface ModelCatalogEntry {
  readonly id: string;
  readonly name?: string;
  readonly owner?: string;
  readonly capabilities?: readonly string[];
  readonly contextWindow?: number;
}

export interface ModelCatalogQuery {
  readonly search?: string;
  readonly refresh?: boolean;
}

export interface ModelCatalogResult<T extends ModelCatalogEntry = ModelCatalogEntry> {
  readonly models: readonly T[];
  readonly source: 'live' | 'cache' | 'stale';
  readonly fetchedAt: string;
}

export interface ModelCatalog<T extends ModelCatalogEntry = ModelCatalogEntry> {
  readonly providerId: string;
  list(query?: ModelCatalogQuery, options?: ModelCallOptions): Promise<ModelCatalogResult<T>>;
}

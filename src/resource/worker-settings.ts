import { ConfigStore } from '../config/store.js';
import type { StartupProfileV1 } from '../config/schema.js';

const WORKER_PROFILE = 'resource-worker';

export interface ResourceWorkerSettingsView {
  readonly revision: string;
  readonly enabled: boolean;
  readonly provider?: StartupProfileV1['provider'];
  readonly model?: string;
  readonly baseURL?: string;
  readonly apiKeyConfigured: boolean;
  readonly active: boolean;
}

export class ResourceWorkerSettings {
  constructor(private readonly store: ConfigStore, private readonly host: { readonly endpoint: string; readonly token: string }) {}

  async read(): Promise<ResourceWorkerSettingsView> {
    const loaded = await this.store.load();
    if (loaded.status !== 'ready' && loaded.status !== 'empty') throw new Error(loaded.status === 'missing' ? 'CONFIG_NOT_FOUND' : 'CONFIG_UNAVAILABLE');
    const name = loaded.config.workerProfile;
    const profile = name ? loaded.config.profiles[name] : loaded.config.profiles[WORKER_PROFILE];
    return { revision: loaded.revision, enabled: Boolean(name), ...(profile ? { provider: profile.provider, model: profile.model, ...('baseURL' in profile ? { baseURL: profile.baseURL } : {}) } : {}), apiKeyConfigured: Boolean(profile && 'apiKey' in profile && profile.apiKey), active: await this.active() };
  }

  async update(value: unknown): Promise<ResourceWorkerSettingsView> {
    const input = parseInput(value);
    const loaded = await this.store.load();
    if (loaded.status !== 'ready' && loaded.status !== 'empty') throw new Error(loaded.status === 'missing' ? 'CONFIG_NOT_FOUND' : 'CONFIG_UNAVAILABLE');
    if (loaded.revision !== input.revision) throw new Error('CONFIG_REVISION_STALE');
    const existing = loaded.config.profiles[WORKER_PROFILE];
    let profiles = loaded.config.profiles;
    if (input.enabled) {
      const apiKey = input.apiKey ?? (existing && 'apiKey' in existing ? existing.apiKey : undefined);
      const profile = createProfile(input, apiKey);
      profiles = { ...profiles, [WORKER_PROFILE]: profile };
    }
    const { workerProfile: _workerProfile, ...base } = loaded.config;
    await this.store.save({ ...base, ...(input.enabled ? { workerProfile: WORKER_PROFILE } : {}), profiles }, loaded.revision);
    return this.read();
  }

  async active(): Promise<boolean> {
    try {
      const response = await fetch(`${this.host.endpoint}/api/v1/inference/status`, { headers: { authorization: `Bearer ${this.host.token}` }, signal: AbortSignal.timeout(3_000) });
      if (!response.ok) return false;
      return (await response.json() as { configured?: unknown }).configured === true;
    } catch { return false; }
  }
}

interface WorkerInput { readonly revision: string; readonly enabled: boolean; readonly provider?: StartupProfileV1['provider']; readonly model?: string; readonly baseURL?: string; readonly apiKey?: string }
function parseInput(value: unknown): WorkerInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('WORKER_SETTINGS_INVALID');
  const item = value as Record<string, unknown>;
  if (typeof item.revision !== 'string' || typeof item.enabled !== 'boolean') throw new Error('WORKER_SETTINGS_INVALID');
  if (!item.enabled) return { revision: item.revision, enabled: false };
  if (item.provider !== 'openai' && item.provider !== 'deepseek' && item.provider !== 'bailian' && item.provider !== 'local') throw new Error('WORKER_PROVIDER_INVALID');
  if (typeof item.model !== 'string' || !item.model.trim()) throw new Error('WORKER_MODEL_REQUIRED');
  for (const field of ['baseURL', 'apiKey'] as const) if (item[field] !== undefined && (typeof item[field] !== 'string' || !item[field].trim())) throw new Error(`WORKER_${field.toUpperCase()}_INVALID`);
  return { revision: item.revision, enabled: true, provider: item.provider, model: item.model.trim(), ...(typeof item.baseURL === 'string' ? { baseURL: item.baseURL.trim() } : {}), ...(typeof item.apiKey === 'string' ? { apiKey: item.apiKey.trim() } : {}) };
}
function createProfile(input: WorkerInput, apiKey: string | undefined): StartupProfileV1 {
  const common = { model: input.model! };
  if (input.provider === 'local') {
    if (!input.baseURL) throw new Error('WORKER_BASEURL_REQUIRED');
    return { ...common, provider: 'local', baseURL: input.baseURL, ...(apiKey ? { apiKey } : {}) };
  }
  if (!apiKey) throw new Error('WORKER_API_KEY_REQUIRED');
  if (input.provider === 'bailian') {
    if (!input.baseURL) throw new Error('WORKER_BASEURL_REQUIRED');
    return { ...common, provider: 'bailian', apiKey, baseURL: input.baseURL };
  }
  return { ...common, provider: input.provider!, apiKey } as StartupProfileV1;
}

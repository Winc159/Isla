import { DEFAULT_MAX_CONTEXT_TURNS } from './core/session.js';
import { DEFAULT_CONTEXT_RETAIN_TURNS, DEFAULT_MAX_CONTEXT_CHARS } from './core/context.js';
import { DEFAULT_PERSONALITY_PROMPT } from './prompts/base.js';

export type OpenAIConfig = {
  readonly provider: 'openai';
  readonly model: string;
  readonly systemPrompt?: string;
  readonly timeoutMs: number;
  readonly debug: boolean;
  readonly maxContextTurns: number;
  readonly maxContextChars: number;
  readonly contextRetainTurns: number;
  readonly modelRetries: number;
  readonly apiKey: string;
  readonly sessionDirectory?: string;
  readonly memoryEnabled: boolean;
  readonly memoryDatabase?: string;
  readonly embeddingProvider?: 'openai' | 'local';
  readonly embeddingModel?: string;
  readonly embeddingBaseURL?: string;
  readonly embeddingApiKey?: string;
  readonly personality?: 'default' | 'minimal';
  readonly logLevel?: 'quiet' | 'normal' | 'debug';
  readonly workspaceRoot?: string;
};
export type DeepSeekConfig = {
  readonly provider: 'deepseek';
  readonly model: string;
  readonly systemPrompt?: string;
  readonly timeoutMs: number;
  readonly debug: boolean;
  readonly maxContextTurns: number;
  readonly maxContextChars: number;
  readonly contextRetainTurns: number;
  readonly modelRetries: number;
  readonly apiKey: string;
  readonly sessionDirectory?: string;
  readonly memoryEnabled: boolean;
  readonly memoryDatabase?: string;
  readonly embeddingProvider?: 'openai' | 'local';
  readonly embeddingModel?: string;
  readonly embeddingBaseURL?: string;
  readonly embeddingApiKey?: string;
  readonly personality?: 'default' | 'minimal';
  readonly logLevel?: 'quiet' | 'normal' | 'debug';
  readonly workspaceRoot?: string;
};
export type LocalConfig = {
  readonly provider: 'local';
  readonly model: string;
  readonly systemPrompt?: string;
  readonly timeoutMs: number;
  readonly debug: boolean;
  readonly maxContextTurns: number;
  readonly maxContextChars: number;
  readonly contextRetainTurns: number;
  readonly modelRetries: number;
  readonly baseURL: string;
  readonly apiKey?: string;
  readonly sessionDirectory?: string;
  readonly memoryEnabled: boolean;
  readonly memoryDatabase?: string;
  readonly embeddingProvider?: 'openai' | 'local';
  readonly embeddingModel?: string;
  readonly embeddingBaseURL?: string;
  readonly embeddingApiKey?: string;
  readonly personality?: 'default' | 'minimal';
  readonly logLevel?: 'quiet' | 'normal' | 'debug';
  readonly workspaceRoot?: string;
};
export type AppConfig = OpenAIConfig | DeepSeekConfig | LocalConfig;

export interface ProfileRuntimeSettingsV1 {
  readonly timeoutMs?: number;
  readonly modelRetries?: 0 | 1;
  readonly maxContextTurns?: number;
  readonly maxContextChars?: number;
  readonly contextRetainTurns?: number;
}

export interface ProfileMemorySettingsV1 {
  readonly enabled?: boolean;
  readonly database?: string;
  readonly embeddingProvider?: 'openai' | 'local';
  readonly embeddingModel?: string;
  readonly embeddingBaseURL?: string;
  readonly embeddingApiKey?: string;
}

export interface ProfileAppearanceSettingsV1 {
  readonly personality?: 'default' | 'minimal';
  readonly logLevel?: 'quiet' | 'normal' | 'debug';
}

interface StartupProfileBaseV1 {
  readonly model: string;
  readonly workspace?: string;
  readonly runtime?: ProfileRuntimeSettingsV1;
  readonly memory?: ProfileMemorySettingsV1;
  readonly appearance?: ProfileAppearanceSettingsV1;
}

export type StartupProfileV1 =
  | (StartupProfileBaseV1 & { readonly provider: 'deepseek'; readonly apiKey: string })
  | (StartupProfileBaseV1 & { readonly provider: 'openai'; readonly apiKey: string })
  | (StartupProfileBaseV1 & { readonly provider: 'local'; readonly baseURL: string; readonly apiKey?: string });

export interface IslaConfigFileV1 {
  readonly version: 1;
  readonly defaultProfile?: string;
  readonly profiles: Readonly<Record<string, StartupProfileV1>>;
}

type UnknownRecord = Record<string, unknown>;
export interface ConfigParseOptions { readonly onWarning?: (message: string) => void; }

export function parseConfigFile(source: string, options: ConfigParseOptions = {}): IslaConfigFileV1 {
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new Error('Invalid Isla config JSON'); }
  if (!isRecord(value) || value.version !== 1) throw new Error('Isla config version must be 1');
  warnUnknown(value, ['version', 'defaultProfile', 'profiles'], 'config', options.onWarning);
  if (!isRecord(value.profiles)) throw new Error('Isla config profiles must be an object');
  const profiles: Record<string, StartupProfileV1> = Object.create(null) as Record<string, StartupProfileV1>;
  for (const [name, raw] of Object.entries(value.profiles)) {
    validateProfileName(name);
    profiles[name] = parseProfile(name, raw, options.onWarning);
  }
  const defaultProfile = value.defaultProfile;
  if (defaultProfile !== undefined) {
    if (typeof defaultProfile !== 'string' || !profiles[defaultProfile]) throw new Error('Isla config defaultProfile does not exist');
  }
  return Object.freeze({ version: 1 as const, ...(defaultProfile !== undefined ? { defaultProfile } : {}), profiles: Object.freeze(profiles) });
}

export function resolveProfile(file: IslaConfigFileV1, name?: string): { readonly name: string; readonly profile: StartupProfileV1 } {
  const selected = name ?? file.defaultProfile ?? (Object.keys(file.profiles).length === 1 ? Object.keys(file.profiles)[0] : undefined);
  if (!selected) throw new Error('Isla config requires an explicit profile');
  const profile = file.profiles[selected];
  if (!profile) throw new Error(`Isla profile not found: ${selected}`);
  return { name: selected, profile };
}

export function profileToAppConfig(profile: StartupProfileV1): AppConfig {
  const runtime = profile.runtime ?? {};
  const memory = profile.memory ?? {};
  const appearance = profile.appearance ?? {};
  const personality = appearance.personality ?? 'default';
  const common = {
    provider: profile.provider,
    model: profile.model,
    ...(profile.workspace ? { workspaceRoot: profile.workspace } : {}),
    timeoutMs: runtime.timeoutMs ?? 600000,
    debug: (appearance.logLevel ?? 'normal') === 'debug',
    logLevel: appearance.logLevel ?? 'normal',
    personality,
    systemPrompt: personality === 'minimal' ? '你是 Isla，简洁、准确、可靠地协助用户完成当前任务。' : DEFAULT_PERSONALITY_PROMPT,
    maxContextTurns: runtime.maxContextTurns ?? DEFAULT_MAX_CONTEXT_TURNS,
    maxContextChars: runtime.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS,
    contextRetainTurns: runtime.contextRetainTurns ?? DEFAULT_CONTEXT_RETAIN_TURNS,
    modelRetries: runtime.modelRetries ?? 0,
    memoryEnabled: memory.enabled ?? true,
    ...(memory.database ? { memoryDatabase: memory.database } : {}),
    ...(memory.embeddingProvider ? {
      embeddingProvider: memory.embeddingProvider,
      ...(memory.embeddingModel ? { embeddingModel: memory.embeddingModel } : {}),
      ...(memory.embeddingBaseURL ? { embeddingBaseURL: memory.embeddingBaseURL } : {}),
      ...(memory.embeddingApiKey ? { embeddingApiKey: memory.embeddingApiKey } : {}),
    } : {}),
  };
  if (profile.provider === 'local') return { ...common, provider: 'local', baseURL: profile.baseURL, ...(profile.apiKey ? { apiKey: profile.apiKey } : {}) };
  return { ...common, provider: profile.provider, apiKey: profile.apiKey };
}

function isRecord(value: unknown): value is UnknownRecord { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

function parseProfile(name: string, value: unknown, onWarning?: (message: string) => void): StartupProfileV1 {
  if (!isRecord(value)) throw new Error(`Isla profile ${name} must be an object`);
  warnUnknown(value, ['provider', 'model', 'apiKey', 'baseURL', 'workspace', 'runtime', 'memory', 'appearance'], `profile ${name}`, onWarning);
  const provider = value.provider;
  const model = nonEmptyString(value.model, `Isla profile ${name}.model`);
  const workspace = value.workspace === undefined ? undefined : nonEmptyString(value.workspace, `Isla profile ${name}.workspace`);
  const base = {
    model,
    ...(workspace ? { workspace } : {}),
    ...(value.runtime !== undefined ? { runtime: parseRuntime(name, value.runtime, onWarning) } : {}),
    ...(value.memory !== undefined ? { memory: parseMemory(name, value.memory, onWarning) } : {}),
    ...(value.appearance !== undefined ? { appearance: parseAppearance(name, value.appearance, onWarning) } : {}),
  };
  if (provider === 'deepseek' || provider === 'openai') return { ...base, provider, apiKey: nonEmptyString(value.apiKey, `Isla profile ${name}.apiKey`) };
  if (provider === 'local') return { ...base, provider, baseURL: validURL(value.baseURL, `Isla profile ${name}.baseURL`), ...(value.apiKey === undefined ? {} : { apiKey: nonEmptyString(value.apiKey, `Isla profile ${name}.apiKey`) }) };
  throw new Error(`Isla profile ${name}.provider is invalid`);
}

function parseRuntime(name: string, value: unknown, onWarning?: (message: string) => void): ProfileRuntimeSettingsV1 {
  if (!isRecord(value)) throw new Error(`Isla profile ${name}.runtime must be an object`);
  warnUnknown(value, ['timeoutMs', 'modelRetries', 'maxContextTurns', 'maxContextChars', 'contextRetainTurns'], `profile ${name}.runtime`, onWarning);
  const positive = (field: string): number | undefined => value[field] === undefined ? undefined : positiveInteger(value[field], `Isla profile ${name}.runtime.${field}`);
  const timeoutMs = positive('timeoutMs');
  const maxContextTurns = positive('maxContextTurns');
  const maxContextChars = positive('maxContextChars');
  const contextRetainTurns = positive('contextRetainTurns');
  const retries = value.modelRetries === undefined ? undefined : value.modelRetries;
  if (retries !== undefined && (retries !== 0 && retries !== 1)) throw new Error(`Isla profile ${name}.runtime.modelRetries is invalid`);
  return { ...(timeoutMs !== undefined ? { timeoutMs } : {}), ...(retries !== undefined ? { modelRetries: retries } : {}), ...(maxContextTurns !== undefined ? { maxContextTurns } : {}), ...(maxContextChars !== undefined ? { maxContextChars } : {}), ...(contextRetainTurns !== undefined ? { contextRetainTurns } : {}) };
}

function parseMemory(name: string, value: unknown, onWarning?: (message: string) => void): ProfileMemorySettingsV1 {
  if (!isRecord(value)) throw new Error(`Isla profile ${name}.memory must be an object`);
  warnUnknown(value, ['enabled', 'database', 'embeddingProvider', 'embeddingModel', 'embeddingBaseURL', 'embeddingApiKey'], `profile ${name}.memory`, onWarning);
  const provider = value.embeddingProvider;
  if (provider !== undefined && provider !== 'openai' && provider !== 'local') throw new Error(`Isla profile ${name}.memory.embeddingProvider is invalid`);
  if (provider && value.embeddingModel === undefined) throw new Error(`Isla profile ${name}.memory.embeddingModel is required`);
  if (provider === 'local' && value.embeddingBaseURL === undefined) throw new Error(`Isla profile ${name}.memory.embeddingBaseURL is required`);
  return {
    ...(value.enabled === undefined ? {} : { enabled: booleanValue(value.enabled, `Isla profile ${name}.memory.enabled`) }),
    ...(value.database === undefined ? {} : { database: nonEmptyString(value.database, `Isla profile ${name}.memory.database`) }),
    ...(provider ? { embeddingProvider: provider, embeddingModel: nonEmptyString(value.embeddingModel, `Isla profile ${name}.memory.embeddingModel`) } : {}),
    ...(value.embeddingBaseURL !== undefined ? { embeddingBaseURL: validURL(value.embeddingBaseURL, `Isla profile ${name}.memory.embeddingBaseURL`) } : {}),
    ...(value.embeddingApiKey !== undefined ? { embeddingApiKey: nonEmptyString(value.embeddingApiKey, `Isla profile ${name}.memory.embeddingApiKey`) } : {}),
  };
}

function parseAppearance(name: string, value: unknown, onWarning?: (message: string) => void): ProfileAppearanceSettingsV1 {
  if (!isRecord(value)) throw new Error(`Isla profile ${name}.appearance must be an object`);
  warnUnknown(value, ['personality', 'logLevel'], `profile ${name}.appearance`, onWarning);
  const personality = value.personality ?? 'default';
  const logLevel = value.logLevel ?? 'normal';
  if (personality !== 'default' && personality !== 'minimal') throw new Error(`Isla profile ${name}.appearance.personality is invalid`);
  if (logLevel !== 'quiet' && logLevel !== 'normal' && logLevel !== 'debug') throw new Error(`Isla profile ${name}.appearance.logLevel is invalid`);
  return { personality, logLevel };
}

function validateProfileName(name: string): void {
  if (!/^[\u0020-\u007e]{1,64}$/.test(name) || ['__proto__', 'prototype', 'constructor'].includes(name)) throw new Error(`Isla profile name is invalid: ${name}`);
}
function warnUnknown(value: UnknownRecord, known: readonly string[], scope: string, onWarning?: (message: string) => void): void {
  if (!onWarning) return;
  const knownSet = new Set(known);
  for (const key of Object.keys(value)) if (!knownSet.has(key)) onWarning(`Ignored unknown Isla config field: ${scope}.${key}`);
}
function nonEmptyString(value: unknown, field: string): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`); return value.trim(); }
function positiveInteger(value: unknown, field: string): number { if (!Number.isInteger(value) || (value as number) <= 0) throw new Error(`${field} must be a positive integer`); return value as number; }
function booleanValue(value: unknown, field: string): boolean { if (typeof value !== 'boolean') throw new Error(`${field} must be boolean`); return value; }
function validURL(value: unknown, field: string): string { const text = nonEmptyString(value, field); try { new URL(text); return text; } catch { throw new Error(`${field} must be a valid URL`); } }

type Env = Record<string, string | undefined>;
export function readConfig(env: Env = process.env): AppConfig {
  const provider = env.ISLA_PROVIDER;
  const model = env.ISLA_MODEL;
  if (provider !== 'openai' && provider !== 'deepseek' && provider !== 'local')
    throw new Error('ISLA_PROVIDER must be openai, deepseek, or local');
  if (!model?.trim()) throw new Error('ISLA_MODEL is required');
  const rawTimeout = env.ISLA_TIMEOUT_MS ?? '600000';
  const timeoutMs = Number(rawTimeout);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0)
    throw new Error('ISLA_TIMEOUT_MS must be a positive integer');
  const debug = env.ISLA_DEBUG === '1' || env.ISLA_DEBUG === 'true';
  const maxContextTurns = Number(env.ISLA_MAX_CONTEXT_TURNS ?? DEFAULT_MAX_CONTEXT_TURNS);
  if (!Number.isInteger(maxContextTurns) || maxContextTurns <= 0)
    throw new Error('ISLA_MAX_CONTEXT_TURNS must be a positive integer');
  const maxContextChars = Number(env.ISLA_MAX_CONTEXT_CHARS ?? DEFAULT_MAX_CONTEXT_CHARS);
  if (!Number.isInteger(maxContextChars) || maxContextChars <= 0)
    throw new Error('ISLA_MAX_CONTEXT_CHARS must be a positive integer');
  const contextRetainTurns = Number(env.ISLA_CONTEXT_RETAIN_TURNS ?? DEFAULT_CONTEXT_RETAIN_TURNS);
  if (!Number.isInteger(contextRetainTurns) || contextRetainTurns <= 0)
    throw new Error('ISLA_CONTEXT_RETAIN_TURNS must be a positive integer');
  const modelRetries = Number(env.ISLA_MODEL_RETRIES ?? '0');
  if (!Number.isInteger(modelRetries) || modelRetries < 0 || modelRetries > 1)
    throw new Error('ISLA_MODEL_RETRIES must be 0 or 1');
  const embeddingProvider: 'openai' | 'local' | undefined = env.ISLA_EMBEDDING_PROVIDER as 'openai' | 'local' | undefined;
  if (embeddingProvider !== undefined && embeddingProvider !== 'openai' && embeddingProvider !== 'local') throw new Error('ISLA_EMBEDDING_PROVIDER must be openai or local');
  if (embeddingProvider && !env.ISLA_EMBEDDING_MODEL?.trim()) throw new Error('ISLA_EMBEDDING_MODEL is required when embeddings are enabled');
  if (embeddingProvider === 'local' && !env.ISLA_EMBEDDING_BASE_URL?.trim()) throw new Error('ISLA_EMBEDDING_BASE_URL is required for local embeddings');
  if (embeddingProvider === 'openai' && !env.ISLA_EMBEDDING_API_KEY && !env.OPENAI_API_KEY) throw new Error('ISLA_EMBEDDING_API_KEY or OPENAI_API_KEY is required for OpenAI embeddings');
  const common = {
    provider,
    model,
    timeoutMs,
    debug,
    maxContextTurns,
    maxContextChars,
    contextRetainTurns,
    modelRetries,
    memoryEnabled: env.ISLA_MEMORY_ENABLED !== '0' && env.ISLA_MEMORY_ENABLED !== 'false',
    ...(env.ISLA_MEMORY_DB ? { memoryDatabase: env.ISLA_MEMORY_DB } : {}),
    ...(embeddingProvider ? { embeddingProvider, embeddingModel: env.ISLA_EMBEDDING_MODEL!, ...(env.ISLA_EMBEDDING_BASE_URL ? { embeddingBaseURL: env.ISLA_EMBEDDING_BASE_URL } : {}), ...(env.ISLA_EMBEDDING_API_KEY ? { embeddingApiKey: env.ISLA_EMBEDDING_API_KEY } : env.OPENAI_API_KEY ? { embeddingApiKey: env.OPENAI_API_KEY } : {}) } : {}),
    ...(env.ISLA_SYSTEM_PROMPT ? { systemPrompt: env.ISLA_SYSTEM_PROMPT } : {}),
    ...(env.ISLA_SESSION_DIR ? { sessionDirectory: env.ISLA_SESSION_DIR } : {}),
  };
  if (provider === 'openai') {
    if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');
    return { ...common, provider, apiKey: env.OPENAI_API_KEY };
  }
  if (provider === 'deepseek') {
    if (!env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY is required');
    return { ...common, provider, apiKey: env.DEEPSEEK_API_KEY };
  }
  if (!env.ISLA_BASE_URL) throw new Error('ISLA_BASE_URL is required');
  try {
    new URL(env.ISLA_BASE_URL);
  } catch {
    throw new Error('ISLA_BASE_URL must be a valid URL');
  }
  return {
    ...common,
    provider,
    baseURL: env.ISLA_BASE_URL,
    ...(env.ISLA_API_KEY ? { apiKey: env.ISLA_API_KEY } : {}),
  };
}

import { isIP } from 'node:net';
import type { McpServerConfig } from '../mcp/types.js';
import type { CapabilityPolicy } from '../capabilities/snapshot.js';
import { DEFAULT_WEB_FETCH } from './profile-app.js';
import { parseMcpProfileSettings } from '../mcp/profile-schema.js';
import { parseCapabilityProfileSettings } from '../capabilities/profile-schema.js';
import { parseAppearance as parseProfileAppearance, parseMemory as parseProfileMemory, parseRuntime as parseProfileRuntime } from './profile-settings.js';
import { validateDependencyManifest, type DependencyManifestV1 } from '../dependencies/manager.js';

export interface WebFetchConfig {
  readonly enabled: boolean;
  readonly allowedHosts: readonly string[];
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly maxBodyChars: number;
  readonly maxOutputChars: number;
  readonly maxRedirects: number;
  readonly allowSearchResultUrls: boolean;
}
export interface WebSearchConfig {
  readonly enabled: boolean;
  readonly provider: 'deepseek-official';
  readonly apiKey: string;
  readonly model: string;
  readonly maxResults: number;
  readonly timeoutMs: number;
  readonly maxOutputChars: number;
}

export interface ExecutionConfig {
  readonly defaultAdapter?: 'local' | 'managed-toolchain' | 'container';
  readonly containerEngine?: 'docker' | 'podman';
  readonly containerImage?: string;
  readonly dependencies?: readonly DependencyManifestV1[];
}

export const DEFAULT_BAILIAN_MODEL = 'qwen-plus';

export type OpenAIConfig = {
  readonly provider: 'openai';
  readonly model: string;
  readonly systemPrompt?: string;
  readonly timeoutMs: number;
  readonly debug: boolean;
  readonly maxContextTurns: number;
  readonly maxContextChars: number;
  readonly contextRetainTurns: number;
  readonly maxContextTokens: number;
  readonly maxOutputTokens: number;
  readonly contextReserveTokens: number;
  readonly modelRetries: number;
  readonly apiKey: string;
  readonly streaming?: boolean;
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
  readonly webFetch?: WebFetchConfig;
  readonly webSearch?: WebSearchConfig;
  readonly mcpServers?: readonly McpServerConfig[];
  readonly capabilityPolicy?: CapabilityPolicy;
  readonly execution?: ExecutionConfig;
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
  readonly maxContextTokens: number;
  readonly maxOutputTokens: number;
  readonly contextReserveTokens: number;
  readonly modelRetries: number;
  readonly apiKey: string;
  readonly streaming?: boolean;
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
  readonly webFetch?: WebFetchConfig;
  readonly webSearch?: WebSearchConfig;
  readonly mcpServers?: readonly McpServerConfig[];
  readonly capabilityPolicy?: CapabilityPolicy;
  readonly execution?: ExecutionConfig;
};
export type BailianConfig = {
  readonly provider: 'bailian';
  readonly model: string;
  readonly systemPrompt?: string;
  readonly timeoutMs: number;
  readonly debug: boolean;
  readonly maxContextTurns: number;
  readonly maxContextChars: number;
  readonly contextRetainTurns: number;
  readonly maxContextTokens: number;
  readonly maxOutputTokens: number;
  readonly contextReserveTokens: number;
  readonly modelRetries: number;
  readonly apiKey: string;
  readonly baseURL: string;
  readonly streaming?: boolean;
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
  readonly webFetch?: WebFetchConfig;
  readonly webSearch?: WebSearchConfig;
  readonly mcpServers?: readonly McpServerConfig[];
  readonly capabilityPolicy?: CapabilityPolicy;
  readonly execution?: ExecutionConfig;
  readonly toolCalling?: boolean;
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
  readonly maxContextTokens: number;
  readonly maxOutputTokens: number;
  readonly contextReserveTokens: number;
  readonly modelRetries: number;
  readonly baseURL: string;
  readonly apiKey?: string;
  readonly streaming?: boolean;
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
  readonly webFetch?: WebFetchConfig;
  readonly webSearch?: WebSearchConfig;
  readonly mcpServers?: readonly McpServerConfig[];
  readonly capabilityPolicy?: CapabilityPolicy;
  readonly execution?: ExecutionConfig;
};
export type AppConfig = OpenAIConfig | DeepSeekConfig | BailianConfig | LocalConfig;

export interface ProfileRuntimeSettingsV1 {
  readonly timeoutMs?: number;
  readonly modelRetries?: 0 | 1;
  readonly maxContextTurns?: number;
  readonly maxContextChars?: number;
  readonly contextRetainTurns?: number;
  readonly maxContextTokens?: number;
  readonly maxOutputTokens?: number;
  readonly contextReserveTokens?: number;
}
export interface ProfileExecutionSettingsV1 extends ExecutionConfig {}

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

export interface ProfileWebFetchSettingsV1 {
  readonly enabled?: boolean;
  readonly allowedHosts?: readonly string[];
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly maxBodyChars?: number;
  readonly maxOutputChars?: number;
  readonly maxRedirects?: number;
  readonly allowSearchResultUrls?: boolean;
}
export interface ProfileWebSearchSettingsV1 { readonly enabled?: boolean; readonly provider?: 'deepseek-official'; readonly apiKey?: string; readonly model?: string; readonly maxResults?: number; readonly timeoutMs?: number; readonly maxOutputChars?: number; }
export interface ProfileToolsSettingsV1 { readonly webFetch?: ProfileWebFetchSettingsV1; readonly webSearch?: ProfileWebSearchSettingsV1; }
export interface ProfileMcpSettingsV1 { readonly servers?: readonly McpServerConfig[]; }
export interface ProfileCapabilitiesSettingsV1 extends CapabilityPolicy {}

interface StartupProfileBaseV1 {
  readonly model: string;
  readonly sessionDirectory?: string;
  readonly workspace?: string;
  readonly runtime?: ProfileRuntimeSettingsV1;
  readonly execution?: ProfileExecutionSettingsV1;
  readonly memory?: ProfileMemorySettingsV1;
  readonly appearance?: ProfileAppearanceSettingsV1;
  readonly tools?: ProfileToolsSettingsV1;
  readonly mcp?: ProfileMcpSettingsV1;
  readonly capabilities?: ProfileCapabilitiesSettingsV1;
}

export type StartupProfileV1 =
  | (StartupProfileBaseV1 & { readonly provider: 'deepseek'; readonly apiKey: string })
  | (StartupProfileBaseV1 & { readonly provider: 'openai'; readonly apiKey: string })
  | (StartupProfileBaseV1 & { readonly provider: 'bailian'; readonly apiKey: string; readonly baseURL: string; readonly streaming?: boolean })
  | (StartupProfileBaseV1 & { readonly provider: 'local'; readonly baseURL: string; readonly apiKey?: string });

export interface IslaConfigFileV1 {
  readonly version: 1;
  readonly defaultProfile?: string;
  readonly workerProfile?: string;
  readonly profiles: Readonly<Record<string, StartupProfileV1>>;
}

type UnknownRecord = Record<string, unknown>;
export interface ConfigParseOptions { readonly onWarning?: (message: string) => void; }

export function parseConfigFile(source: string, options: ConfigParseOptions = {}): IslaConfigFileV1 {
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new Error('Invalid Isla config JSON'); }
  if (!isRecord(value) || value.version !== 1) throw new Error('Isla config version must be 1');
  warnUnknown(value, ['version', 'defaultProfile', 'workerProfile', 'profiles'], 'config', options.onWarning);
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
  const workerProfile = value.workerProfile;
  if (workerProfile !== undefined && (typeof workerProfile !== 'string' || !profiles[workerProfile])) throw new Error('Isla config workerProfile does not exist');
  return Object.freeze({ version: 1 as const, ...(defaultProfile !== undefined ? { defaultProfile } : {}), ...(workerProfile !== undefined ? { workerProfile } : {}), profiles: Object.freeze(profiles) });
}

export { resolveProfile, resolveWorkerProfile } from './profile-selection.js';
export { readConfig, type ConfigEnvironment } from './env-compat.js';
export { profileToAppConfig } from './profile-app.js';

function isRecord(value: unknown): value is UnknownRecord { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

function parseProfile(name: string, value: unknown, onWarning?: (message: string) => void): StartupProfileV1 {
  if (!isRecord(value)) throw new Error(`Isla profile ${name} must be an object`);
  warnUnknown(value, ['provider', 'model', 'apiKey', 'baseURL', 'streaming', 'workspace', 'sessionDirectory', 'runtime', 'execution', 'memory', 'appearance', 'tools', 'mcp', 'capabilities'], `profile ${name}`, onWarning);
  const provider = value.provider;
  const model = nonEmptyString(value.model, `Isla profile ${name}.model`);
  const workspace = value.workspace === undefined ? undefined : nonEmptyString(value.workspace, `Isla profile ${name}.workspace`);
  const base = {
    model,
    ...(value.sessionDirectory ? { sessionDirectory: nonEmptyString(value.sessionDirectory, `Isla profile ${name}.sessionDirectory`) } : {}),
    ...(workspace ? { workspace } : {}),
    ...(value.runtime !== undefined ? { runtime: parseProfileRuntime(name, value.runtime, warnUnknown, onWarning) } : {}),
    ...(value.execution !== undefined ? { execution: parseProfileExecution(name, value.execution, warnUnknown, onWarning) } : {}),
    ...(value.memory !== undefined ? { memory: parseProfileMemory(name, value.memory, warnUnknown, onWarning) } : {}),
    ...(value.appearance !== undefined ? { appearance: parseProfileAppearance(name, value.appearance, warnUnknown, onWarning) } : {}),
    ...(value.tools !== undefined ? { tools: parseTools(name, value.tools, onWarning) } : {}),
    ...(value.mcp !== undefined ? { mcp: parseMcpProfileSettings(name, value.mcp) } : {}),
    ...(value.capabilities !== undefined ? { capabilities: parseCapabilityProfileSettings(name, value.capabilities, warnUnknown) } : {}),
  };
  if (provider === 'deepseek' || provider === 'openai') return { ...base, provider, apiKey: nonEmptyString(value.apiKey, `Isla profile ${name}.apiKey`) };
  if (provider === 'bailian') return { ...base, provider, baseURL: validURL(value.baseURL, `Isla profile ${name}.baseURL`), apiKey: nonEmptyString(value.apiKey, `Isla profile ${name}.apiKey`), ...(value.streaming === undefined ? {} : { streaming: booleanValue(value.streaming, `Isla profile ${name}.streaming`) }) };
  if (provider === 'local') return { ...base, provider, baseURL: validURL(value.baseURL, `Isla profile ${name}.baseURL`), ...(value.apiKey === undefined ? {} : { apiKey: nonEmptyString(value.apiKey, `Isla profile ${name}.apiKey`) }) };
  throw new Error(`Isla profile ${name}.provider is invalid`);
}

function parseProfileExecution(name: string, value: unknown, warnUnknown: (value: UnknownRecord, known: readonly string[], scope: string, onWarning?: (message: string) => void) => void, onWarning?: (message: string) => void): ProfileExecutionSettingsV1 {
  if (!isRecord(value)) throw new Error(`Isla profile ${name}.execution must be an object`);
  warnUnknown(value, ['defaultAdapter', 'containerEngine', 'containerImage', 'dependencies'], `profile ${name}.execution`, onWarning);
  const defaultAdapter = value.defaultAdapter;
  const containerEngine = value.containerEngine;
  if (defaultAdapter !== undefined && !['local', 'managed-toolchain', 'container'].includes(String(defaultAdapter))) throw new Error(`Isla profile ${name}.execution.defaultAdapter is invalid`);
  if (containerEngine !== undefined && containerEngine !== 'docker' && containerEngine !== 'podman') throw new Error(`Isla profile ${name}.execution.containerEngine is invalid`);
  const containerImage = value.containerImage === undefined ? undefined : nonEmptyString(value.containerImage, `Isla profile ${name}.execution.containerImage`);
  if (containerImage !== undefined && !/^[A-Za-z0-9._/:+-]+@sha256:[a-f0-9]{64}$/iu.test(containerImage)) throw new Error(`Isla profile ${name}.execution.containerImage must use a pinned sha256 digest`);
  if (defaultAdapter === 'container' && containerImage === undefined) throw new Error(`Isla profile ${name}.execution.containerImage is required for the container adapter`);
  const dependencies = value.dependencies === undefined ? undefined : parseDependencyManifests(name, value.dependencies);
  return { ...(defaultAdapter === undefined ? {} : { defaultAdapter: defaultAdapter as Exclude<ExecutionConfig['defaultAdapter'], undefined> }), ...(containerEngine === undefined ? {} : { containerEngine }), ...(containerImage === undefined ? {} : { containerImage }), ...(dependencies === undefined ? {} : { dependencies }) };
}

function parseDependencyManifests(name: string, value: unknown): readonly DependencyManifestV1[] {
  if (!Array.isArray(value) || value.length > 256) throw new Error(`Isla profile ${name}.execution.dependencies must be an array of at most 256 fixed manifests`);
  const manifests = value.map((raw, index) => {
    try {
      if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.version !== 'string' || typeof raw.platform !== 'string' || typeof raw.arch !== 'string' || typeof raw.source !== 'string' || typeof raw.sha256 !== 'string' || typeof raw.maxDownloadBytes !== 'number' || raw.archive !== 'tar.gz' || !Array.isArray(raw.executables) || raw.executables.some(item => typeof item !== 'string') || typeof raw.license !== 'string' || !isRecord(raw.versionProbe) || typeof raw.versionProbe.executable !== 'string' || !Array.isArray(raw.versionProbe.argv) || raw.versionProbe.argv.some(item => typeof item !== 'string') || typeof raw.versionProbe.expected !== 'string') throw new Error('invalid shape');
      if (!['win32', 'darwin', 'linux', 'freebsd', 'openbsd', 'sunos', 'aix', 'android', 'netbsd', 'haiku', 'cygwin'].includes(raw.platform)) throw new Error('invalid platform');
      return validateDependencyManifest({ id: raw.id, version: raw.version, platform: raw.platform as NodeJS.Platform, arch: raw.arch, source: raw.source, sha256: raw.sha256, maxDownloadBytes: raw.maxDownloadBytes, archive: 'tar.gz', executables: raw.executables as string[], license: raw.license, versionProbe: { executable: raw.versionProbe.executable, argv: raw.versionProbe.argv as string[], expected: raw.versionProbe.expected } });
    } catch { throw new Error(`Isla profile ${name}.execution.dependencies[${index}] is invalid; manifests require fixed HTTPS sources, SHA-256, bounded archives and version probes`); }
  });
  if (new Set(manifests.map(item => `${item.id}\0${item.version}\0${item.platform}\0${item.arch}`)).size !== manifests.length) throw new Error(`Isla profile ${name}.execution.dependencies contains duplicate platform manifests`);
  return Object.freeze(manifests);
}

function parseTools(name: string, value: unknown, onWarning?: (message: string) => void): ProfileToolsSettingsV1 {
  if (!isRecord(value)) throw new Error(`Isla profile ${name}.tools must be an object`);
  warnUnknown(value, ['webFetch', 'webSearch'], `profile ${name}.tools`, onWarning);
  return { ...(value.webFetch === undefined ? {} : { webFetch: parseWebFetch(name, value.webFetch, onWarning) }), ...(value.webSearch === undefined ? {} : { webSearch: parseWebSearch(name, value.webSearch, onWarning) }) };
}

function parseWebSearch(name: string, value: unknown, onWarning?: (message: string) => void): ProfileWebSearchSettingsV1 {
  if (!isRecord(value)) throw new Error(`Isla profile ${name}.tools.webSearch must be an object`);
  warnUnknown(value, ['enabled', 'provider', 'apiKey', 'model', 'maxResults', 'timeoutMs', 'maxOutputChars'], `profile ${name}.tools.webSearch`, onWarning);
  const provider = value.provider === undefined ? undefined : value.provider;
  if (provider !== undefined && provider !== 'deepseek-official') throw new Error(`Isla profile ${name}.tools.webSearch.provider is invalid`);
  const bounded = (field: 'maxResults' | 'timeoutMs' | 'maxOutputChars', min: number, max: number): number | undefined => value[field] === undefined ? undefined : (!Number.isInteger(value[field]) || (value[field] as number) < min || (value[field] as number) > max) ? (() => { throw new Error(`Isla profile ${name}.tools.webSearch.${field} is invalid`); })() : value[field] as number;
  const maxResults = bounded('maxResults', 1, 20); const timeoutMs = bounded('timeoutMs', 1, 120_000); const maxOutputChars = bounded('maxOutputChars', 1, 200_000);
  const apiKey = value.apiKey === undefined ? undefined : nonEmptyString(value.apiKey, `Isla profile ${name}.tools.webSearch.apiKey`);
  const model = value.model === undefined ? undefined : nonEmptyString(value.model, `Isla profile ${name}.tools.webSearch.model`);
  return { ...(value.enabled === undefined ? {} : { enabled: booleanValue(value.enabled, `Isla profile ${name}.tools.webSearch.enabled`) }), ...(provider === undefined ? {} : { provider }), ...(apiKey === undefined ? {} : { apiKey }), ...(model === undefined ? {} : { model }), ...(maxResults === undefined ? {} : { maxResults }), ...(timeoutMs === undefined ? {} : { timeoutMs }), ...(maxOutputChars === undefined ? {} : { maxOutputChars }) };
}

function parseWebFetch(name: string, value: unknown, onWarning?: (message: string) => void): ProfileWebFetchSettingsV1 {
  if (!isRecord(value)) throw new Error(`Isla profile ${name}.tools.webFetch must be an object`);
  warnUnknown(value, ['enabled', 'allowedHosts', 'timeoutMs', 'maxResponseBytes', 'maxBodyChars', 'maxOutputChars', 'maxRedirects', 'allowSearchResultUrls'], `profile ${name}.tools.webFetch`, onWarning);
  const enabled = value.enabled === undefined ? false : booleanValue(value.enabled, `Isla profile ${name}.tools.webFetch.enabled`);
  const rawHosts = value.allowedHosts === undefined ? [] : value.allowedHosts;
  if (!Array.isArray(rawHosts)) throw new Error(`Isla profile ${name}.tools.webFetch.allowedHosts must be an array`);
  if (rawHosts.length > 32) throw new Error(`Isla profile ${name}.tools.webFetch.allowedHosts must contain at most 32 hosts`);
  const hosts = [...new Set(rawHosts.map((host, index) => normalizeWebHost(host, `Isla profile ${name}.tools.webFetch.allowedHosts[${index}]`)))].sort();
  // An enabled Web Fetch profile may omit hosts; the runtime applies its
  // built-in HTTPS/SSRF/size limits instead of requiring user-maintained DNS lists.
  const effectiveHosts = enabled && hosts.length === 0 ? ['*'] : hosts;
  const bounded = (field: keyof typeof DEFAULT_WEB_FETCH, min: number, max: number): number | undefined => {
    const raw = value[field];
    if (raw === undefined) return undefined;
    if (!Number.isInteger(raw) || (raw as number) < min || (raw as number) > max) throw new Error(`Isla profile ${name}.tools.webFetch.${field} is invalid`);
    return raw as number;
  };
  const timeoutMs = bounded('timeoutMs', 1, 120_000);
  const maxResponseBytes = bounded('maxResponseBytes', 1, 5_000_000);
  const maxBodyChars = bounded('maxBodyChars', 1, 200_000);
  const maxOutputChars = bounded('maxOutputChars', 1, 200_000);
  const maxRedirects = bounded('maxRedirects', 0, 5);
  return Object.freeze({ enabled, allowedHosts: Object.freeze(effectiveHosts), allowSearchResultUrls: booleanValue(value.allowSearchResultUrls ?? false, `Isla profile ${name}.tools.webFetch.allowSearchResultUrls`), ...(timeoutMs === undefined ? {} : { timeoutMs }), ...(maxResponseBytes === undefined ? {} : { maxResponseBytes }), ...(maxBodyChars === undefined ? {} : { maxBodyChars }), ...(maxOutputChars === undefined ? {} : { maxOutputChars }), ...(maxRedirects === undefined ? {} : { maxRedirects }) });
}

export type { McpServerConfig } from '../mcp/types.js';

function normalizeWebHost(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`${field} must be a hostname`);
  const input = value.toLowerCase();
  if (input.includes('*') || input.includes('/') || input.includes('@')) throw new Error(`${field} must be an exact hostname`);
  let parsed: URL;
  try { parsed = new URL(`https://${input}`); } catch { throw new Error(`${field} must be a hostname`); }
  if (parsed.port || parsed.pathname !== '/' || parsed.search || parsed.username || parsed.password || isIP(parsed.hostname) !== 0 || !parsed.hostname.includes('.')) throw new Error(`${field} must be an exact public hostname`);
  return parsed.hostname;
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

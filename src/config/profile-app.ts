import { DEFAULT_CONTEXT_RETAIN_TURNS, DEFAULT_MAX_CONTEXT_CHARS } from '../core/context.js';
import { DEFAULT_MAX_CONTEXT_TURNS } from '../core/session.js';
import { DEFAULT_PERSONALITY_PROMPT } from '../prompts/base.js';
import type { AppConfig, ProfileWebFetchSettingsV1, ProfileWebSearchSettingsV1, StartupProfileV1, WebFetchConfig, WebSearchConfig } from './schema.js';

export const DEFAULT_WEB_FETCH = { timeoutMs: 30_000, maxResponseBytes: 1_000_000, maxBodyChars: 60_000, maxOutputChars: 80_000, maxRedirects: 3 } as const;

export function profileToAppConfig(profile: StartupProfileV1): AppConfig {
  const runtime = profile.runtime ?? {};
  const memory = profile.memory ?? {};
  const appearance = profile.appearance ?? {};
  const personality = appearance.personality ?? 'default';
  const common = {
    provider: profile.provider,
    model: profile.model,
    ...(profile.sessionDirectory ? { sessionDirectory: profile.sessionDirectory } : {}),
    ...(profile.workspace ? { workspaceRoot: profile.workspace } : {}),
    timeoutMs: runtime.timeoutMs ?? 600000,
    debug: (appearance.logLevel ?? 'normal') === 'debug',
    logLevel: appearance.logLevel ?? 'normal',
    personality,
    systemPrompt: personality === 'minimal' ? '你是 Isla，简洁、准确、可靠地协助用户完成当前任务。' : DEFAULT_PERSONALITY_PROMPT,
    maxContextTurns: runtime.maxContextTurns ?? DEFAULT_MAX_CONTEXT_TURNS,
    maxContextChars: runtime.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS,
    contextRetainTurns: runtime.contextRetainTurns ?? DEFAULT_CONTEXT_RETAIN_TURNS,
    maxContextTokens: runtime.maxContextTokens ?? 16000,
    maxOutputTokens: runtime.maxOutputTokens ?? 2048,
    contextReserveTokens: runtime.contextReserveTokens ?? 512,
    modelRetries: runtime.modelRetries ?? 1,
    memoryEnabled: memory.enabled ?? true,
    ...(memory.database ? { memoryDatabase: memory.database } : {}),
    ...(memory.embeddingProvider ? {
      embeddingProvider: memory.embeddingProvider,
      ...(memory.embeddingModel ? { embeddingModel: memory.embeddingModel } : {}),
      ...(memory.embeddingBaseURL ? { embeddingBaseURL: memory.embeddingBaseURL } : {}),
      ...(memory.embeddingApiKey ? { embeddingApiKey: memory.embeddingApiKey } : {}),
    } : {}),
    // Web Fetch is a built-in read-only capability. Keep its security limits
    // internal so a normal user does not need to maintain a host allowlist.
    ...(profile.tools?.webFetch ? { webFetch: normalizeWebFetchConfig(profile.tools.webFetch) } : { webFetch: normalizeWebFetchConfig({ enabled: true, allowedHosts: ['*'] }) }),
    ...(profile.tools?.webSearch?.enabled && (profile.tools.webSearch.apiKey ?? profile.apiKey) ? { webSearch: normalizeWebSearchConfig(profile.tools.webSearch, profile.tools.webSearch.apiKey ?? profile.apiKey!, profile.tools.webSearch.model ?? profile.model) } : {}),
    ...(profile.mcp?.servers?.length ? { mcpServers: profile.mcp.servers } : {}),
    ...(profile.capabilities ? { capabilityPolicy: profile.capabilities } : {}),
    ...(profile.execution ? { execution: profile.execution } : {}),
  };
  if (profile.provider === 'local') return { ...common, provider: 'local', baseURL: profile.baseURL, ...(profile.apiKey ? { apiKey: profile.apiKey } : {}) };
  if (profile.provider === 'bailian') return { ...common, provider: 'bailian', baseURL: profile.baseURL, apiKey: profile.apiKey, ...(profile.streaming === undefined ? {} : { streaming: profile.streaming }) };
  return { ...common, provider: profile.provider, apiKey: profile.apiKey };
}

function normalizeWebFetchConfig(value: ProfileWebFetchSettingsV1): WebFetchConfig {
  return Object.freeze({ enabled: value.enabled ?? true, allowedHosts: Object.freeze([...(value.allowedHosts ?? ['*'])]), allowSearchResultUrls: value.allowSearchResultUrls ?? false, timeoutMs: value.timeoutMs ?? DEFAULT_WEB_FETCH.timeoutMs, maxResponseBytes: value.maxResponseBytes ?? DEFAULT_WEB_FETCH.maxResponseBytes, maxBodyChars: value.maxBodyChars ?? DEFAULT_WEB_FETCH.maxBodyChars, maxOutputChars: value.maxOutputChars ?? DEFAULT_WEB_FETCH.maxOutputChars, maxRedirects: value.maxRedirects ?? DEFAULT_WEB_FETCH.maxRedirects });
}

function normalizeWebSearchConfig(value: ProfileWebSearchSettingsV1, apiKey: string, model: string): WebSearchConfig {
  return Object.freeze({ enabled: value.enabled ?? true, provider: 'deepseek-official', apiKey, model, maxResults: value.maxResults ?? 8, timeoutMs: value.timeoutMs ?? 30_000, maxOutputChars: value.maxOutputChars ?? 12_000 });
}

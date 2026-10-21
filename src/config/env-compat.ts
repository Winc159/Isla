import { DEFAULT_CONTEXT_RETAIN_TURNS, DEFAULT_MAX_CONTEXT_CHARS } from '../core/context.js';
import { DEFAULT_MAX_CONTEXT_TURNS } from '../core/session.js';
import type { AppConfig } from './schema.js';

export type ConfigEnvironment = Record<string, string | undefined>;

export function readConfig(env: ConfigEnvironment = process.env): AppConfig {
  const provider = env.ISLA_PROVIDER;
  const model = env.ISLA_MODEL;
  if (provider !== 'openai' && provider !== 'deepseek' && provider !== 'bailian' && provider !== 'local') throw new Error('ISLA_PROVIDER must be openai, deepseek, bailian, or local');
  if (!model?.trim()) throw new Error('ISLA_MODEL is required');
  const timeoutMs = Number(env.ISLA_TIMEOUT_MS ?? '600000');
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('ISLA_TIMEOUT_MS must be a positive integer');
  const debug = env.ISLA_DEBUG === '1' || env.ISLA_DEBUG === 'true';
  const maxContextTurns = Number(env.ISLA_MAX_CONTEXT_TURNS ?? DEFAULT_MAX_CONTEXT_TURNS);
  if (!Number.isInteger(maxContextTurns) || maxContextTurns <= 0) throw new Error('ISLA_MAX_CONTEXT_TURNS must be a positive integer');
  const maxContextChars = Number(env.ISLA_MAX_CONTEXT_CHARS ?? DEFAULT_MAX_CONTEXT_CHARS);
  if (!Number.isInteger(maxContextChars) || maxContextChars <= 0) throw new Error('ISLA_MAX_CONTEXT_CHARS must be a positive integer');
  const contextRetainTurns = Number(env.ISLA_CONTEXT_RETAIN_TURNS ?? DEFAULT_CONTEXT_RETAIN_TURNS);
  if (!Number.isInteger(contextRetainTurns) || contextRetainTurns <= 0) throw new Error('ISLA_CONTEXT_RETAIN_TURNS must be a positive integer');
  const maxContextTokens = Number(env.ISLA_MAX_CONTEXT_TOKENS ?? '16000');
  const maxOutputTokens = Number(env.ISLA_MAX_OUTPUT_TOKENS ?? '2048');
  const contextReserveTokens = Number(env.ISLA_CONTEXT_RESERVE_TOKENS ?? '512');
  if (![maxContextTokens, maxOutputTokens, contextReserveTokens].every(value => Number.isInteger(value) && value > 0)) throw new Error('ISLA token budgets must be positive integers');
  const modelRetries = Number(env.ISLA_MODEL_RETRIES ?? '1');
  if (!Number.isInteger(modelRetries) || modelRetries < 0 || modelRetries > 1) throw new Error('ISLA_MODEL_RETRIES must be 0 or 1');
  const embeddingProvider = env.ISLA_EMBEDDING_PROVIDER as 'openai' | 'local' | undefined;
  if (embeddingProvider !== undefined && embeddingProvider !== 'openai' && embeddingProvider !== 'local') throw new Error('ISLA_EMBEDDING_PROVIDER must be openai or local');
  if (embeddingProvider && !env.ISLA_EMBEDDING_MODEL?.trim()) throw new Error('ISLA_EMBEDDING_MODEL is required when embeddings are enabled');
  if (embeddingProvider === 'local' && !env.ISLA_EMBEDDING_BASE_URL?.trim()) throw new Error('ISLA_EMBEDDING_BASE_URL is required for local embeddings');
  if (embeddingProvider === 'openai' && !env.ISLA_EMBEDDING_API_KEY && !env.OPENAI_API_KEY) throw new Error('ISLA_EMBEDDING_API_KEY or OPENAI_API_KEY is required for OpenAI embeddings');
  const common = {
    provider, model, timeoutMs, debug, maxContextTurns, maxContextChars, contextRetainTurns, maxContextTokens, maxOutputTokens, contextReserveTokens, modelRetries,
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
  if (provider === 'bailian') {
    if (!env.DASHSCOPE_API_KEY) throw new Error('DASHSCOPE_API_KEY is required');
    if (!env.ISLA_BASE_URL) throw new Error('ISLA_BASE_URL is required');
    try { new URL(env.ISLA_BASE_URL); } catch { throw new Error('ISLA_BASE_URL must be a valid URL'); }
    return { ...common, provider, apiKey: env.DASHSCOPE_API_KEY, baseURL: env.ISLA_BASE_URL, ...(env.ISLA_BAILIAN_STREAMING === '1' || env.ISLA_BAILIAN_STREAMING === 'true' ? { streaming: true } : {}) };
  }
  if (!env.ISLA_BASE_URL) throw new Error('ISLA_BASE_URL is required');
  try { new URL(env.ISLA_BASE_URL); } catch { throw new Error('ISLA_BASE_URL must be a valid URL'); }
  return { ...common, provider, baseURL: env.ISLA_BASE_URL, ...(env.ISLA_API_KEY ? { apiKey: env.ISLA_API_KEY } : {}) };
}

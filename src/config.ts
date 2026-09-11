import { DEFAULT_MAX_CONTEXT_TURNS } from './core/session.js';
import { DEFAULT_CONTEXT_RETAIN_TURNS, DEFAULT_MAX_CONTEXT_CHARS } from './core/context.js';

export type OpenAIConfig = {
  readonly provider: 'openai';
  readonly model: string;
  readonly systemPrompt?: string;
  readonly timeoutMs: number;
  readonly debug: boolean;
  readonly maxContextTurns: number;
  readonly maxContextChars: number;
  readonly contextRetainTurns: number;
  readonly apiKey: string;
  readonly sessionDirectory?: string;
  readonly memoryEnabled: boolean;
  readonly memoryDatabase?: string;
  readonly embeddingProvider?: 'openai' | 'local';
  readonly embeddingModel?: string;
  readonly embeddingBaseURL?: string;
  readonly embeddingApiKey?: string;
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
  readonly apiKey: string;
  readonly sessionDirectory?: string;
  readonly memoryEnabled: boolean;
  readonly memoryDatabase?: string;
  readonly embeddingProvider?: 'openai' | 'local';
  readonly embeddingModel?: string;
  readonly embeddingBaseURL?: string;
  readonly embeddingApiKey?: string;
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
  readonly baseURL: string;
  readonly apiKey?: string;
  readonly sessionDirectory?: string;
  readonly memoryEnabled: boolean;
  readonly memoryDatabase?: string;
  readonly embeddingProvider?: 'openai' | 'local';
  readonly embeddingModel?: string;
  readonly embeddingBaseURL?: string;
  readonly embeddingApiKey?: string;
};
export type AppConfig = OpenAIConfig | DeepSeekConfig | LocalConfig;
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

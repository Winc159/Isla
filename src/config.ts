export type OpenAIConfig = {
  readonly provider: 'openai';
  readonly model: string;
  readonly systemPrompt?: string;
  readonly timeoutMs: number;
  readonly debug: boolean;
  readonly apiKey: string;
};
export type DeepSeekConfig = {
  readonly provider: 'deepseek';
  readonly model: string;
  readonly systemPrompt?: string;
  readonly timeoutMs: number;
  readonly debug: boolean;
  readonly apiKey: string;
};
export type LocalConfig = {
  readonly provider: 'local';
  readonly model: string;
  readonly systemPrompt?: string;
  readonly timeoutMs: number;
  readonly debug: boolean;
  readonly baseURL: string;
  readonly apiKey?: string;
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
  const common = {
    provider,
    model,
    timeoutMs,
    debug,
    ...(env.ISLA_SYSTEM_PROMPT ? { systemPrompt: env.ISLA_SYSTEM_PROMPT } : {}),
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

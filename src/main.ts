import { readConfig, type AppConfig } from './config.js';
import { IslaRuntime } from './core/runtime.js';
import { createOpenAIPlugin } from './providers/openai.js';
import { createDeepSeekPlugin } from './providers/deepseek.js';
import { createLocalPlugin } from './providers/local.js';
export function createRuntime(config: AppConfig): IslaRuntime {
  const r = new IslaRuntime();
  if (config.provider === 'openai') r.use(createOpenAIPlugin(config));
  else if (config.provider === 'deepseek') r.use(createDeepSeekPlugin(config));
  else r.use(createLocalPlugin(config));
  return r;
}
export function loadRuntime(): { runtime: IslaRuntime; config: AppConfig } {
  const config = readConfig();
  return { runtime: createRuntime(config), config };
}

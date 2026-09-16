import { profileToAppConfig, readConfig, resolveProfile, type AppConfig } from './config.js';
import { IslaRuntime } from './core/runtime.js';
import { createOpenAIPlugin } from './providers/openai.js';
import { createDeepSeekPlugin } from './providers/deepseek.js';
import { createLocalPlugin } from './providers/local.js';
import { createBailianPlugin } from './providers/bailian.js';
import { ConfigStore, defaultConfigPath } from './config-store.js';
import { parseCliStartupArgs, type CliStartupArgs } from './cli-args.js';
import { resolveWorkspace } from './workspace.js';
import { listBailianModels } from './models/bailian-catalog.js';
import { listDeepSeekModels } from './models/deepseek-catalog.js';
export function createRuntime(config: AppConfig): IslaRuntime {
  const r = new IslaRuntime();
  if (config.provider === 'openai') r.use(createOpenAIPlugin(config));
  else if (config.provider === 'deepseek') r.use(createDeepSeekPlugin(config));
  else if (config.provider === 'bailian') r.use(createBailianPlugin(config));
  else r.use(createLocalPlugin(config));
  return r;
}
export async function loadRuntime(argv: readonly string[] = process.argv.slice(2), env: Record<string, string | undefined> = process.env): Promise<{ runtime: IslaRuntime; config: AppConfig; startup: CliStartupArgs }> {
  const startup = parseCliStartupArgs(argv);
  const config = await loadStartupConfig(startup, env);
  const workspaceRoot = await resolveWorkspace(startup.workspacePath, config.workspaceRoot, process.cwd());
  const resolvedConfig = { ...config, workspaceRoot } as AppConfig;
  if (startup.models) {
    const models = resolvedConfig.provider === 'bailian'
      ? await listBailianModels(resolvedConfig.baseURL, resolvedConfig.apiKey)
      : resolvedConfig.provider === 'deepseek'
        ? await listDeepSeekModels(resolvedConfig.apiKey)
        : (() => { throw new Error(`--models is not supported for the ${resolvedConfig.provider} provider`); })();
    process.stdout.write(`${JSON.stringify(models)}\n`);
  }
  return { runtime: createRuntime(resolvedConfig), config: resolvedConfig, startup };
}

async function loadStartupConfig(startup: CliStartupArgs, env: Record<string, string | undefined>): Promise<AppConfig> {
  if (startup.useEnv) return readConfig(env);
  const store = new ConfigStore(startup.configPath ?? defaultConfigPath());
  const loaded = await store.load();
  if (loaded.status === 'ready') return profileToAppConfig(resolveProfile(loaded.config, startup.profileName).profile);
  if (loaded.status === 'invalid' || loaded.status === 'unreadable') throw new Error(`Unable to load Isla config: ${loaded.message}`);
  if (startup.profileName) throw new Error(`Isla profile configuration is unavailable: ${startup.profileName}`);
  // Migration compatibility: a complete environment configuration remains usable until a config file is created.
  return readConfig(env);
}

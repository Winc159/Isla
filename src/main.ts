import { profileToAppConfig, readConfig, resolveProfile, resolveWorkerProfile, type AppConfig } from './config.js';
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
import { McpHost } from './mcp/host.js';
import { ResourceStructuredInferenceService } from './resource/inference.js';
import type { StructuredInferenceRequestV1, StructuredInferenceSuccessV1 } from './resource/contracts.js';
import type { ModelProvider } from './core/types.js';

export type StructuredInferenceHandler = (request: StructuredInferenceRequestV1, signal: AbortSignal) => Promise<StructuredInferenceSuccessV1<unknown>>;

export interface WorkerRuntimeBinding {
  readonly profileName: string;
  readonly config: AppConfig;
  readonly model: { readonly provider: AppConfig['provider']; readonly model: string; readonly profile: string; readonly configRevision: string };
  readonly provider: ModelProvider;
  readonly inference: StructuredInferenceHandler;
}

export function createWorkerRuntimeBinding(config: AppConfig, profileName: string, configRevision = 'runtime'): WorkerRuntimeBinding {
  const runtime = createRuntime(config);
  const provider = runtime.getProvider(config.provider);
  if (!provider) throw new Error(`Worker provider not found: ${config.provider}`);
  const model = { role: 'resource-worker' as const, provider: config.provider, model: config.model, profile: profileName, configRevision } as const;
  const service = new ResourceStructuredInferenceService({ provider, model });
  return { profileName, config, model, provider, inference: (request, signal) => service.run(request, signal) };
}
export function createRuntime(config: AppConfig): IslaRuntime {
  const r = new IslaRuntime();
  if (config.provider === 'openai') r.use(createOpenAIPlugin(config));
  else if (config.provider === 'deepseek') r.use(createDeepSeekPlugin(config));
  else if (config.provider === 'bailian') r.use(createBailianPlugin(config));
  else r.use(createLocalPlugin(config));
  return r;
}
export async function loadRuntime(argv: readonly string[] = process.argv.slice(2), env: Record<string, string | undefined> = process.env): Promise<{ runtime: IslaRuntime; config: AppConfig; startup: CliStartupArgs; worker?: WorkerRuntimeBinding; mcpHost?: McpHost }> {
  const startup = parseCliStartupArgs(argv);
  const loaded = await loadStartupConfig(startup, env);
  const config = loaded.config;
  const workspaceRoot = await resolveWorkspace(startup.workspacePath, config.workspaceRoot, process.cwd());
  let resolvedConfig = { ...config, workspaceRoot } as AppConfig;
  if (resolvedConfig.provider === 'bailian') {
    try {
      const matches = await listBailianModels(resolvedConfig.baseURL, resolvedConfig.apiKey, { model: resolvedConfig.model, maxPages: 1 });
      const entry = matches.find(item => item.id === resolvedConfig.model);
      if (entry) {
        const markers = [...entry.features, ...entry.capabilities].map(value => value.toLowerCase().replaceAll('_', '-'));
        resolvedConfig = { ...resolvedConfig, toolCalling: markers.some(value => value === 'function-calling' || value === 'functioncalling' || value === 'tool-calling' || value === 'tools') };
      }
    } catch {
      resolvedConfig = { ...resolvedConfig, toolCalling: true };
    }
  }
  if (startup.models) {
    const models = resolvedConfig.provider === 'bailian'
      ? await listBailianModels(resolvedConfig.baseURL, resolvedConfig.apiKey)
      : resolvedConfig.provider === 'deepseek'
        ? await listDeepSeekModels(resolvedConfig.apiKey)
        : (() => { throw new Error(`--models is not supported for the ${resolvedConfig.provider} provider`); })();
    process.stdout.write(`${JSON.stringify(models)}\n`);
  }
  const mcpHost = resolvedConfig.mcpServers?.length ? new McpHost(resolvedConfig.mcpServers) : undefined;
  if (mcpHost) await mcpHost.start();
  return { runtime: createRuntime(resolvedConfig), config: resolvedConfig, startup, ...(loaded.worker ? { worker: createWorkerRuntimeBinding(loaded.worker.config, loaded.worker.name, loaded.worker.revision) } : {}), ...(mcpHost ? { mcpHost } : {}) };
}

async function loadStartupConfig(startup: CliStartupArgs, env: Record<string, string | undefined>): Promise<{ config: AppConfig; worker?: { name: string; config: AppConfig; revision: string } }> {
  if (startup.useEnv) return { config: readConfig(env) };
  const store = new ConfigStore(startup.configPath ?? defaultConfigPath());
  const loaded = await store.load();
  if (loaded.status === 'ready') {
    const primary = resolveProfile(loaded.config, startup.profileName);
    const worker = resolveWorkerProfile(loaded.config);
    return { config: profileToAppConfig(primary.profile), ...(worker ? { worker: { name: worker.name, config: profileToAppConfig(worker.profile), revision: String(loaded.revision) } } : {}) };
  }
  if (loaded.status === 'invalid' || loaded.status === 'unreadable') throw new Error(`Unable to load Isla config: ${loaded.message}`);
  if (startup.profileName) throw new Error(`Isla profile configuration is unavailable: ${startup.profileName}`);
  // Migration compatibility: a complete environment configuration remains usable until a config file is created.
  return { config: readConfig(env) };
}

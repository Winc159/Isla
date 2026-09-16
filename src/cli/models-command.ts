import type { CliCommand } from './command.js';
import { listBailianModels, type BailianModelCatalogEntry } from '../models/bailian-catalog.js';
import { listDeepSeekModels } from '../models/deepseek-catalog.js';
import type { ModelCatalogEntry } from '../models/catalog.js';
import { modelCatalogCacheIdentity, modelCatalogCachePath, readModelCatalogCache, writeModelCatalogCache } from '../models/catalog-cache.js';

export const modelsCommand: CliCommand = {
  name: '/models',
  description: '查询并切换当前 Profile 的模型',
  usage: '/models [list|search <text>|use <model>]',
  inputMode: 'line',
  async execute(context) {
    if (!context.configStore || !context.configPath) { context.output.write('当前运行没有连接到 Profile 配置文件。\n'); return { type: 'continue' }; }
    const configPath = context.configPath;
    const loaded = await context.configStore.load();
    if (loaded.status !== 'ready') { context.output.write('当前没有可用 Profile 配置。\n'); return { type: 'continue' }; }
    const profileName = context.profileName ?? loaded.config.defaultProfile;
    const profile = profileName ? loaded.config.profiles[profileName] : undefined;
    if (!profileName || !profile || !['bailian', 'deepseek'].includes(profile.provider)) { context.output.write('当前 Provider 不支持模型目录。\n'); return { type: 'continue' }; }
    const selectedProfileName = profileName;
    const tokens = (context.commandLine ?? '/models').trim().split(/\s+/);
    const action = tokens[1] ?? 'list';
    if (action !== 'list' && action !== 'refresh' && !(action === 'search' && tokens.length === 3) && !(action === 'use' && tokens.length === 3)) { context.output.write('用法：/models [list|search <text>|refresh|use <model>]\n'); return { type: 'continue' }; }
    const catalogEndpoint = profile.provider === 'bailian'
      ? new URL('/api/v1/models', new URL(profile.baseURL).origin).toString()
      : 'https://api.deepseek.com/models';
    const cacheIdentity = modelCatalogCacheIdentity(profile.provider, selectedProfileName, catalogEndpoint);
    const cachePath = modelCatalogCachePath(configPath, profile.provider, selectedProfileName, catalogEndpoint);
    if (action === 'use') {
      const requestedModel = tokens[2]!;
      try {
        let available = (await readModelCatalogCache<ModelCatalogEntry>(cachePath, cacheIdentity))?.models;
        if (!available) {
          available = profile.provider === 'bailian'
            ? await listBailianModels(profile.baseURL, profile.apiKey)
            : await listDeepSeekModels(profile.apiKey!);
          await writeModelCatalogCache(cachePath, available, cacheIdentity);
        }
        if (!available.some(item => item.id === requestedModel)) { context.output.write(`模型 ${requestedModel} 不在当前目录中，未修改 Profile。\n`); return { type: 'continue' }; }
        await context.configStore.save({ ...loaded.config, profiles: { ...loaded.config.profiles, [selectedProfileName]: { ...profile, model: requestedModel } } }, loaded.revision);
        context.output.write(`已将 Profile ${selectedProfileName} 的模型改为 ${requestedModel}，下次启动生效。\n`);
      } catch (error) { context.output.write(`模型选择失败：${error instanceof Error ? error.message : 'Unknown error'}\n`); }
      return { type: 'continue' };
    }
    try {
      const search = action === 'search' ? tokens[2]! : undefined;
      const models: readonly ModelCatalogEntry[] = profile.provider === 'bailian'
        ? await listBailianModels(profile.baseURL, profile.apiKey, search ? { search } : {})
        : await listDeepSeekModels(profile.apiKey!).then(items => search ? items.filter(item => item.id.toLowerCase().includes(search.toLowerCase())) : items);
      await writeModelCatalogCache(cachePath, models, cacheIdentity);
      for (const model of models) context.output.write(`${model.id}${model.name ? ` · ${model.name}` : ''}${('provider' in model && model.provider) ? ` · ${model.provider}` : model.owner ? ` · ${model.owner}` : ''}\n`);
      if (!models.length) context.output.write('未找到模型。\n');
    } catch (error) {
      const cached = await readModelCatalogCache<BailianModelCatalogEntry>(cachePath, cacheIdentity);
      if (!cached) context.output.write(`模型目录查询失败：${error instanceof Error ? error.message : 'Unknown error'}\n`);
      else { context.output.write(`模型目录查询失败，使用缓存（${cached.fetchedAt}）。\n`); for (const model of cached.models) context.output.write(`${model.id}${model.name ? ` · ${model.name}` : ''}${model.provider ? ` · ${model.provider}` : model.owner ? ` · ${model.owner}` : ''}\n`); }
    }
    return { type: 'continue' };
  },
};

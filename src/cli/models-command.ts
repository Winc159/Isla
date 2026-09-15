import type { CliCommand } from './command.js';
import { listBailianModels } from '../models/bailian-catalog.js';
import { readModelCatalogCache, writeModelCatalogCache } from '../models/catalog-cache.js';
import { join } from 'node:path';

export const modelsCommand: CliCommand = {
  name: '/models',
  description: '查询并切换当前 Profile 的模型',
  usage: '/models [list|search <text>|use <model>]',
  inputMode: 'line',
  async execute(context) {
    if (!context.configStore || !context.configPath) { context.output.write('当前运行没有连接到 Profile 配置文件。\n'); return { type: 'continue' }; }
    const loaded = await context.configStore.load();
    if (loaded.status !== 'ready') { context.output.write('当前没有可用 Profile 配置。\n'); return { type: 'continue' }; }
    const profileName = context.profileName ?? loaded.config.defaultProfile;
    const profile = profileName ? loaded.config.profiles[profileName] : undefined;
    if (!profile || profile.provider !== 'bailian') { context.output.write('模型目录目前仅支持 Bailian Profile。\n'); return { type: 'continue' }; }
    const tokens = (context.commandLine ?? '/models').trim().split(/\s+/);
    const action = tokens[1] ?? 'list';
    if (action === 'use' && tokens.length === 3) {
      const model = tokens[2]!;
      await context.configStore.save({ ...loaded.config, profiles: { ...loaded.config.profiles, [profileName!]: { ...profile, model } } }, loaded.revision);
      context.output.write(`已将 Profile ${profileName} 的模型改为 ${model}，下次启动生效。\n`);
      return { type: 'continue' };
    }
    if (action !== 'list' && !(action === 'search' && tokens.length === 3)) { context.output.write('用法：/models [list|search <text>|use <model>]\n'); return { type: 'continue' }; }
    const cachePath = join(context.configPath, '..', `models-${profileName}.json`);
    try {
      const query = action === 'search' ? { name: tokens[2]! } : {};
      const models = await listBailianModels(profile.baseURL, profile.apiKey, query);
      await writeModelCatalogCache(cachePath, models);
      for (const model of models) context.output.write(`${model.id}${model.name ? ` · ${model.name}` : ''}${model.provider ? ` · ${model.provider}` : ''}\n`);
      if (!models.length) context.output.write('未找到模型。\n');
    } catch (error) {
      const cached = await readModelCatalogCache(cachePath);
      if (!cached) context.output.write(`模型目录查询失败：${error instanceof Error ? error.message : 'Unknown error'}\n`);
      else { context.output.write(`模型目录查询失败，使用缓存（${cached.fetchedAt}）。\n`); for (const model of cached.models) context.output.write(`${model.id}${model.name ? ` · ${model.name}` : ''}${model.provider ? ` · ${model.provider}` : ''}\n`); }
    }
    return { type: 'continue' };
  },
};

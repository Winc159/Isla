import type { CliCommand } from './command.js';
import { isInteractiveInput, type InteractiveInput } from './command.js';
import { emitKeypressEvents, type Key } from 'node:readline';
import type { Writable } from 'node:stream';
import { listBailianModels, type BailianModelCatalogEntry } from '../models/bailian-catalog.js';
import { listDeepSeekModels } from '../models/deepseek-catalog.js';
import type { ModelCatalogEntry } from '../models/catalog.js';
import { modelCatalogCacheIdentity, modelCatalogCachePath, readModelCatalogCache, writeModelCatalogCache } from '../models/catalog-cache.js';

export const modelsCommand: CliCommand = {
  name: '/models',
  description: '查询模型；用 /models use <model-id> 切换',
  usage: '/models [list|browse|search <text>|refresh|info <model-id>|use <model>]',
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
    if (action !== 'list' && action !== 'browse' && action !== 'refresh' && !(action === 'search' && tokens.length === 3) && !(action === 'use' && tokens.length === 3) && !(action === 'info' && tokens.length === 3)) { context.output.write('用法：/models [list|browse|search <text>|refresh|info <model-id>|use <model>]\n'); return { type: 'continue' }; }
    const catalogEndpoint = profile.provider === 'bailian'
      ? new URL('/api/v1/models', new URL(profile.baseURL).origin).toString()
      : 'https://api.deepseek.com/models';
    const cacheIdentity = modelCatalogCacheIdentity(profile.provider, selectedProfileName, catalogEndpoint);
    const cachePath = modelCatalogCachePath(configPath, profile.provider, selectedProfileName, catalogEndpoint);
    if (action === 'info') {
      const requestedModel = tokens[2]!;
      try {
        let available = (await readModelCatalogCache<ModelCatalogEntry>(cachePath, cacheIdentity))?.models;
        if (!available) {
          available = profile.provider === 'bailian' ? await listBailianModels(profile.baseURL, profile.apiKey) : await listDeepSeekModels(profile.apiKey!);
          await writeModelCatalogCache(cachePath, available, cacheIdentity);
        }
        const model = available.find(item => item.id === requestedModel);
        if (!model) { context.output.write(`模型 ${requestedModel} 不在当前目录中。\n`); return { type: 'continue' }; }
        context.output.write(`${JSON.stringify({ id: model.id, name: model.name, capabilities: model.capabilities, features: ('features' in model ? model.features : undefined), contextWindow: model.contextWindow, maxInputTokens: ('maxInputTokens' in model ? model.maxInputTokens : undefined), maxOutputTokens: ('maxOutputTokens' in model ? model.maxOutputTokens : undefined), maxReasoningTokens: ('maxReasoningTokens' in model ? model.maxReasoningTokens : undefined) })}\n`);
      } catch (error) { context.output.write(`模型信息查询失败：${error instanceof Error ? error.message : 'Unknown error'}\n`); }
      return { type: 'continue' };
    }
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
      if (action === 'browse' && isInteractiveInput(context.input)) await browseModels(context.input, context.output, models);
      else {
        writeModelPreview(context.output, models);
        if (action === 'browse' && !isInteractiveInput(context.input)) context.output.write('当前输入不是 TTY，无法进入交互浏览。\n');
      }
    } catch (error) {
      const cached = await readModelCatalogCache<BailianModelCatalogEntry>(cachePath, cacheIdentity);
      if (!cached) context.output.write(`模型目录查询失败：${error instanceof Error ? error.message : 'Unknown error'}\n`);
      else {
        context.output.write(`模型目录查询失败，使用缓存（${cached.fetchedAt}）。\n`);
        if (action === 'browse' && isInteractiveInput(context.input)) await browseModels(context.input, context.output, cached.models);
        else {
          writeModelPreview(context.output, cached.models);
          if (action === 'browse' && !isInteractiveInput(context.input)) context.output.write('当前输入不是 TTY，无法进入交互浏览。\n');
        }
      }
    }
    return { type: 'continue' };
  },
};

const MODEL_PREVIEW_LIMIT = 10;

export function writeModelPreview(output: Writable, models: readonly ModelCatalogEntry[]): void {
  if (!models.length) { output.write('未找到模型。\n'); return; }
  for (const model of models.slice(0, MODEL_PREVIEW_LIMIT)) output.write(`${formatModel(model)}\n`);
  if (models.length > MODEL_PREVIEW_LIMIT) output.write(`还有 ${models.length - MODEL_PREVIEW_LIMIT} 个模型，输入 /models browse 进入 TTY 浏览全部。\n`);
  output.write('切换模型：/models use <model-id>（下次启动生效）\n');
}

async function browseModels(input: InteractiveInput, output: Writable, models: readonly ModelCatalogEntry[]): Promise<void> {
  if (!models.length) { output.write('未找到模型。\n'); return; }
  const pageSize = 10;
  let selectedIndex = 0;
  emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  output.write('\x1b[?1049h');
  const render = () => {
    const pageStart = Math.floor(selectedIndex / pageSize) * pageSize;
    output.write(`\x1b[2J\x1b[H模型目录 ${selectedIndex + 1}/${models.length}  ↑↓ 移动  PgUp/PgDn 翻页  Esc 返回\n\n`);
    models.slice(pageStart, pageStart + pageSize).forEach((model, index) => output.write(`${pageStart + index === selectedIndex ? '>' : ' '} ${formatModel(model)}\n`));
  };
  render();
  await new Promise<void>(resolve => {
    const finish = () => { input.removeListener('keypress', onKeypress); input.setRawMode(false); output.write('\x1b[?1049l'); resolve(); };
    const onKeypress = (_text: string, key: Key) => {
      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) { finish(); return; }
      if (key.name === 'up') selectedIndex = Math.max(0, selectedIndex - 1);
      else if (key.name === 'down') selectedIndex = Math.min(models.length - 1, selectedIndex + 1);
      else if (key.name === 'pageup') selectedIndex = Math.max(0, selectedIndex - pageSize);
      else if (key.name === 'pagedown') selectedIndex = Math.min(models.length - 1, selectedIndex + pageSize);
      else return;
      render();
    };
    input.on('keypress', onKeypress);
  });
}

function formatModel(model: ModelCatalogEntry): string {
  return `${model.id}${model.name ? ` · ${model.name}` : ''}${('provider' in model && model.provider) ? ` · ${model.provider}` : model.owner ? ` · ${model.owner}` : ''}`;
}

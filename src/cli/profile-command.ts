import type { CliCommand } from './command.js';

export const profileCommand: CliCommand = {
  name: '/profile',
  description: '查看和选择启动 Profile',
  usage: '/profile [list|use <name>]',
  inputMode: 'line',
  async execute(context) {
    const tokens = (context.commandLine ?? '/profile').trim().split(/\s+/);
    const action = tokens[1] ?? 'show';
    if (!context.configStore) {
      context.output.write('当前运行没有连接到 Profile 配置文件。\n');
      return { type: 'continue' };
    }
    const loaded = await context.configStore.load();
    if (loaded.status === 'missing' || loaded.status === 'empty') {
      context.output.write('当前没有可用 Profile。\n');
      return { type: 'continue' };
    }
    if (loaded.status === 'invalid' || loaded.status === 'unreadable') {
      context.output.write(`配置不可用：${loaded.message}\n`);
      return { type: 'continue' };
    }
    const current = context.profileName ?? loaded.config.defaultProfile;
    if (action === 'show') {
      const profile = current ? loaded.config.profiles[current] : undefined;
      context.output.write(`当前 Profile：${current ?? '未选择'}${profile ? ` · ${profile.provider} · ${profile.model}` : ''}\n`);
      return { type: 'continue' };
    }
    if (action === 'list' && tokens.length === 2) {
      for (const name of Object.keys(loaded.config.profiles).sort((a, b) => a.localeCompare(b))) {
        const profile = loaded.config.profiles[name]!;
        context.output.write(`${name === current ? '*' : ' '} ${name} · ${profile.provider} · ${profile.model}${name === loaded.config.defaultProfile ? ' · 默认' : ''}\n`);
      }
      return { type: 'continue' };
    }
    if (action === 'use' && tokens.length === 3) {
      const name = tokens[2]!;
      if (!loaded.config.profiles[name]) {
        context.output.write(`未找到 Profile：${name}\n`);
        return { type: 'continue' };
      }
      if (name === loaded.config.defaultProfile) {
        context.output.write(`Profile ${name} 已是默认项。\n`);
        return { type: 'continue' };
      }
      await context.configStore.save({ ...loaded.config, defaultProfile: name }, loaded.revision);
      context.output.write(`已将 ${name} 设为默认 Profile，修改将在下次启动生效。\n`);
      return { type: 'continue' };
    }
    context.output.write('用法：/profile [list|use <name>]\n');
    return { type: 'continue' };
  },
};

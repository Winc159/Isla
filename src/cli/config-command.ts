import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isInteractiveInput } from './command.js';
import type { CliCommand } from './command.js';
import { runSetupWizard } from './setup-wizard.js';

const execFileAsync = promisify(execFile);

export const configCommand: CliCommand = {
  name: '/config',
  description: '查看或设置启动配置',
  usage: '/config [show|open|setup]',
  inputMode: 'line',
  async execute(context) {
    const action = (context.commandLine ?? '/config').trim().slice('/config'.length).trim() || 'show';
    if (!context.configStore || !context.configPath) {
      context.output.write('当前运行没有连接到 Profile 配置文件。\n');
      return { type: 'continue' };
    }
    if (action === 'show') {
      const loaded = await context.configStore.load();
      if (loaded.status === 'missing') context.output.write(`配置文件不存在：${context.configPath}\n`);
      else if (loaded.status === 'invalid' || loaded.status === 'unreadable') context.output.write(`配置不可用：${loaded.message}\n`);
      else {
        const profileName = context.profileName ?? (loaded.status === 'ready' ? loaded.config.defaultProfile : undefined);
        const profile = profileName ? loaded.config.profiles[profileName] : undefined;
        context.output.write(`配置文件：${context.configPath}\n当前 Profile：${profileName ?? '未选择'}\nProvider：${profile?.provider ?? context.providerId}\nModel：${profile?.model ?? context.model}\nAPI Key：${profile && 'apiKey' in profile && profile.apiKey ? '已配置' : '未配置'}\nMemory：${profile?.memory?.enabled === false ? '关闭' : '开启'}\nPersonality：${profile?.appearance?.personality ?? 'default'}\n日志：${profile?.appearance?.logLevel ?? (context.systemPrompt ? 'normal' : 'normal')}\n修改将在下次启动生效。\n`);
      }
      return { type: 'continue' };
    }
    if (action === 'open') {
      try { await (context.openConfig ?? openConfigFile)(context.configPath); context.output.write(`已打开配置文件，修改将在下次启动生效：${context.configPath}\n`); }
      catch (error) { context.output.write(`打开配置文件失败：${error instanceof Error ? error.message : 'Unknown error'}\n`); }
      return { type: 'continue' };
    }
    if (action === 'setup') {
      if (!isInteractiveInput(context.input)) { context.output.write('配置向导需要交互式终端。\n'); return { type: 'continue' }; }
      await runSetupWizard(context.input, context.output, context.configStore, context.input);
      return { type: 'continue' };
    }
    context.output.write('用法：/config [show|open|setup]\n');
    return { type: 'continue' };
  },
};

async function openConfigFile(path: string): Promise<void> {
  if (process.platform === 'win32') await execFileAsync('explorer.exe', [path]);
  else if (process.platform === 'darwin') await execFileAsync('open', [path]);
  else await execFileAsync('xdg-open', [path]);
}

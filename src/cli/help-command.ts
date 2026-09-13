import type { CliCommand } from './command.js';

export const helpCommand: CliCommand = {
  name: '/help',
  description: '显示命令和快捷键帮助',
  inputMode: 'line',
  async execute(context) {
    context.output.write('可用命令：\n');
    for (const command of context.availableCommands) {
      context.output.write(`  ${command.name.padEnd(12)}${command.description}\n`);
    }
    context.output.write(
      '\n快捷键：\n'
      + '  Enter       发送消息\n'
      + '  Shift+Enter 插入换行（终端支持时）\n'
      + '  Alt+Enter   插入换行\n'
      + '  Tab         补全唯一匹配的 slash token\n'
      + '  Esc         退出 Isla\n'
      + '  Ctrl+C      生成中取消本轮；空闲时退出\n\n',
    );
    return { type: 'continue' };
  },
};

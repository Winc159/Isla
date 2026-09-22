import type { CliCommand } from './command.js';

export const capabilitiesCommand: CliCommand = {
  name: '/capabilities',
  description: '查看当前请求可用的能力目录',
  usage: '/capabilities [check <id>]',
  inputMode: 'line',
  async execute(context) {
    const snapshot = context.capabilitySnapshot?.();
    if (!snapshot) { context.output.write('当前能力目录不可用。\n'); return { type: 'continue' }; }
    const parts = (context.commandLine ?? '').trim().split(/\s+/);
    const requested = parts[1] === 'check' ? parts.slice(2).join(' ') : undefined;
    if (requested) {
      const entry = snapshot.entries.find(item => item.id === requested);
      context.output.write(entry ? `${JSON.stringify(entry)}\n` : `未找到能力：${requested}\n`);
      return { type: 'continue' };
    }
    context.output.write(`${JSON.stringify({ version: snapshot.version, hash: snapshot.hash, entries: snapshot.entries })}\n`);
    return { type: 'continue' };
  },
};

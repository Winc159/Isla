import type { CliCommand } from './command.js';
import { browserCheck } from '../browser/runtime.js';

export const browserCommand: CliCommand = {
  name: '/browser',
  description: '检查无头浏览器状态',
  usage: '/browser check',
  inputMode: 'line',
  async execute(context) {
    const action = (context.commandLine ?? '/browser').trim().split(/\s+/)[1] ?? 'check';
    if (action !== 'check') { context.output.write('用法：/browser check\n'); return { type: 'continue' }; }
    const result = await browserCheck();
    context.output.write(`${JSON.stringify({ ...result, headless: true, bind: 'loopback-only', install: result.available ? 'ready' : 'run isla browser install' })}\n`);
    return { type: 'continue' };
  },
};

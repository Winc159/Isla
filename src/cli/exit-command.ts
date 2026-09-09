import type { CliCommand } from './command.js';

export const exitCommand: CliCommand = {
  name: '/exit',
  description: '退出 Isla',
  inputMode: 'line',
  async execute() {
    return { type: 'exit' };
  },
};

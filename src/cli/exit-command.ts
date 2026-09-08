import type { CliCommand } from './command.js';

export const exitCommand: CliCommand = {
  name: '/exit',
  inputMode: 'line',
  async execute() {
    return { type: 'exit' };
  },
};

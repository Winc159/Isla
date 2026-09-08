import type { CliCommand } from './command.js';
import { exitCommand } from './exit-command.js';
import { newCommand } from './new-command.js';
import { sessionsCommand } from './sessions-command.js';

const commands = new Map<string, CliCommand>(
  [exitCommand, newCommand, sessionsCommand].map(command => [command.name, command]),
);

export function findCliCommand(line: string): CliCommand | undefined {
  return commands.get(line);
}

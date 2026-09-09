import type { CliCommand } from './command.js';
import { exitCommand } from './exit-command.js';
import { helpCommand } from './help-command.js';
import { newCommand } from './new-command.js';
import { sessionsCommand } from './sessions-command.js';

const registeredCommands = [newCommand, sessionsCommand, helpCommand, exitCommand];
const commands = new Map<string, CliCommand>(
  registeredCommands.map(command => [command.name, command]),
);

export function findCliCommand(line: string): CliCommand | undefined {
  return commands.get(line);
}

export function listCliCommands(): readonly CliCommand[] {
  return registeredCommands;
}

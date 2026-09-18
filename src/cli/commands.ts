import type { CliCommand } from './command.js';
import { exitCommand } from './exit-command.js';
import { helpCommand } from './help-command.js';
import { newCommand } from './new-command.js';
import { sessionsCommand } from './sessions-command.js';
import { memoryCommand } from './memory-command.js';
import { traceCommand } from './trace-command.js';
import { configCommand } from './config-command.js';
import { profileCommand } from './profile-command.js';
import { modelsCommand } from './models-command.js';
import { taskCommand } from './task-command.js';

const registeredCommands = [newCommand, sessionsCommand, taskCommand, memoryCommand, traceCommand, configCommand, profileCommand, modelsCommand, helpCommand, exitCommand];
const commands = new Map<string, CliCommand>(
  registeredCommands.map(command => [command.name, command]),
);

export function findCliCommand(line: string): CliCommand | undefined {
  return commands.get(line) ?? (line.startsWith('/memory ') ? commands.get('/memory') : undefined) ?? (line.startsWith('/trace ') ? commands.get('/trace') : undefined) ?? (line.startsWith('/config ') ? commands.get('/config') : undefined) ?? (line.startsWith('/profile ') ? commands.get('/profile') : undefined) ?? (line.startsWith('/models ') ? commands.get('/models') : undefined);
}

export function listCliCommands(): readonly CliCommand[] {
  return registeredCommands;
}

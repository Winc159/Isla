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
import { skillsCommand } from './skills-command.js';
import { mcpCommand } from './mcp-command.js';
import { capabilitiesCommand } from './capabilities-command.js';
import { contextCommand } from './context-command.js';

const registeredCommands = [newCommand, sessionsCommand, taskCommand, skillsCommand, capabilitiesCommand, contextCommand, memoryCommand, traceCommand, configCommand, profileCommand, modelsCommand, mcpCommand, helpCommand, exitCommand];
const commands = new Map<string, CliCommand>(
  registeredCommands.map(command => [command.name, command]),
);

export function findCliCommand(line: string): CliCommand | undefined {
  if (line === '/skill') return commands.get('/skills');
  return commands.get(line) ?? (line.startsWith('/skills ') || line.startsWith('/skill ') ? commands.get('/skills') : undefined) ?? (line.startsWith('/capabilities ') ? commands.get('/capabilities') : undefined) ?? (line.startsWith('/context ') ? commands.get('/context') : undefined) ?? (line.startsWith('/memory ') ? commands.get('/memory') : undefined) ?? (line.startsWith('/trace ') ? commands.get('/trace') : undefined) ?? (line.startsWith('/config ') ? commands.get('/config') : undefined) ?? (line.startsWith('/profile ') ? commands.get('/profile') : undefined) ?? (line.startsWith('/models ') ? commands.get('/models') : undefined) ?? (line.startsWith('/mcp ') ? commands.get('/mcp') : undefined);
}

export function listCliCommands(): readonly CliCommand[] {
  return registeredCommands;
}

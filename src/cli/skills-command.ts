import type { CliCommand } from './command.js';
import { SkillCatalog } from '../skills/catalog.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const skillsCommand: CliCommand = {
  name: '/skills',
  description: '查看当前会话可用的 Skills，或加载一个 Skill',
  usage: '/skills [name]',
  inputMode: 'line',
  async execute(context) {
    let entries = 'skillCatalog' in context.currentSession && context.currentSession.skillCatalog
      ? context.currentSession.skillCatalog.entries
      : [];
    const liveCatalog = new SkillCatalog({ workspaceRoot: join(context.workspaceRoot, '.isla', 'skills'), personalRoot: join(homedir(), '.isla', 'skills') });
    if (!entries.length) entries = liveCatalog.listSync().entries;
    const commandLine = context.commandLine?.trim() ?? '';
    const name = commandLine.startsWith('/skill ') ? commandLine.slice('/skill'.length).trim() : commandLine.slice('/skills'.length).trim();
    if (!name) {
      context.output.write(entries.length ? `${entries.filter(entry => entry.userInvocable).map(entry => `- ${entry.name}: ${entry.description}`).join('\n')}\n` : '当前会话没有可用 Skill。\n');
      return { type: 'continue' };
    }
    const entry = entries.find(item => item.name === name && item.userInvocable);
    if (!entry) { context.output.write('Skill 不存在或不可由用户调用。\n'); return { type: 'continue' }; }
    const definition = liveCatalog.loadSync(name);
    if (!definition) { context.output.write('Skill 正文当前不可用，请使用 /new 刷新会话。\n'); return { type: 'continue' }; }
    context.output.write(`<skill_content name="${definition.name}">\n${definition.content}\n</skill_content>\n`);
    return { type: 'continue' };
  },
};

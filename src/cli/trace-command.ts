import type { CliCommand } from './command.js';
import { verifyRequestSnapshot } from '../core/request-snapshot.js';
import { deriveVerificationStatus } from '../core/verification.js';

export const traceCommand: CliCommand = {
  name: '/trace',
  description: '查看会话 Turn 健康状态（不显示正文）',
  usage: '/trace [sequence]',
  inputMode: 'line',
  async execute(context) {
    const journal = context.currentSession.journal;
    if (!journal?.turns.length) {
      context.output.write('无历史运行记录\n');
      return { type: 'continue' };
    }
    const argument = context.commandLine?.trim().slice('/trace'.length).trim();
    const sequence = argument ? Number(argument) : undefined;
    const turns = sequence === undefined ? journal.turns.slice(-10) : journal.turns.filter(turn => turn.sequence === sequence);
    if (!turns.length) {
      context.output.write(sequence === undefined ? '无历史运行记录\n' : `未找到 Turn ${argument}\n`);
      return { type: 'continue' };
    }
    for (const turn of turns) {
      const attempts = turn.attempts;
      const invalidHashes = attempts.filter(attempt => !verifyRequestSnapshot(attempt.request)).length;
      const tools = turn.actions.filter(action => action.type === 'tool').map(action => action.tool).join(',') || '-';
      const projectSources = turn.actions.filter(action => action.type === 'project_retrieval').reduce((total, action) => total + action.sourceIds.length, 0);
      const error = turn.error?.code ?? attempts.find(attempt => attempt.error)?.error?.code ?? '-';
      const duration = turn.endedAt ? `${Math.max(0, Date.parse(turn.endedAt) - Date.parse(turn.startedAt))}ms` : '进行中';
      const capabilitySnapshots = turn.actions.filter(action => action.type === 'capability_snapshot').length;
      const budgetStops = turn.actions.filter((action): action is Extract<typeof action, { type: 'loop_budget' }> => action.type === 'loop_budget' && action.event === 'stop').map(action => action.reason ?? 'unspecified').join(',') || '-';
      const checkpoints = turn.actions.filter(action => action.type === 'checkpoint').length;
      const failedTools = turn.actions.filter(action => action.type === 'tool' && !action.ok).length;
      context.output.write(`Turn ${turn.sequence} · ${turn.status} · ${duration} · attempts=${attempts.length} · tools=${tools} · failedTools=${failedTools} · projectSources=${projectSources} · capabilitySnapshots=${capabilitySnapshots} · checkpoints=${checkpoints} · budgetStops=${budgetStops} · verification=${deriveVerificationStatus(journal)} · error=${error} · hashInvalid=${invalidHashes}\n`);
    }
    return { type: 'continue' };
  },
};

import type { CliCommand } from './command.js';
import { deriveVerificationStatus } from '../core/verification.js';
import { summarizeTaskState } from '../core/task-state.js';

export const taskCommand: CliCommand = {
  name: '/task', description: '查看当前任务状态', inputMode: 'line',
  async execute(context) {
    const task = 'task' in context.currentSession ? context.currentSession.task : undefined;
    if (!task || !('version' in task)) { context.output.write('当前 Session 没有活动任务\n'); return { type: 'continue' }; }
    const summary = summarizeTaskState(task);
    context.output.write(`任务：${summary.goal}\n状态：${summary.status} · 已完成 ${summary.completedSteps}/${summary.totalSteps} · blockers=${summary.blockerCount} · openQuestions=${summary.openQuestionCount}\n验证：${deriveVerificationStatus(context.currentSession.journal ?? { version: 1, turns: [] })}\n`);
    return { type: 'continue' };
  },
};

import type { CliCommand } from './command.js';
import { DEFAULT_CONTEXT_RETAIN_TURNS, DEFAULT_MAX_CONTEXT_CHARS, measureContextBudget } from '../core/context.js';
import { DEFAULT_MAX_CONTEXT_TURNS } from '../core/session.js';

export const contextCommand: CliCommand = {
  name: '/context',
  description: '查看当前会话上下文预算状态',
  usage: '/context',
  inputMode: 'line',
  async execute(context) {
    const checkpoint = 'context' in context.currentSession ? context.currentSession.context?.checkpoint : undefined;
    const report = measureContextBudget(context.currentSession.messages, { maxTurns: context.maxContextTurns ?? DEFAULT_MAX_CONTEXT_TURNS, maxChars: context.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS }, checkpoint);
    context.output.write(`${JSON.stringify({ ...report, retainTurns: DEFAULT_CONTEXT_RETAIN_TURNS })}\n`);
    return { type: 'continue' };
  },
};

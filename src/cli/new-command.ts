import type { CliCommand } from './command.js';

export const newCommand: CliCommand = {
  name: '/new',
  inputMode: 'line',
  async execute(context) {
    const messages = context.systemPrompt
      ? [{ role: 'system' as const, content: context.systemPrompt }]
      : [];
    const session = await context.sessionStore.create(
      context.providerId,
      context.model,
      messages,
    );
    return { type: 'switch-session', session, replayHistory: false };
  },
};

import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { traceCommand } from '../../src/cli/trace-command.js';
import { createRequestSnapshot } from '../../src/core/request-snapshot.js';

describe('/trace', () => {
  it('prints safe turn metadata without message or tool result bodies', async () => {
    const output = new PassThrough(); const chunks: Buffer[] = [];
    output.on('data', chunk => chunks.push(Buffer.from(chunk)));
    const snapshot = createRequestSnapshot({ messages: [{ role: 'user', content: 'PRIVATE_USER_TEXT' }] }, 'local', 'm');
    await traceCommand.execute({ input: new PassThrough(), output, providerId: 'local', model: 'm', systemPrompt: undefined, sessionStore: {} as never, currentSession: { version: 3, id: 's', createdAt: 'now', updatedAt: 'now', provider: 'local', model: 'm', messages: [{ role: 'user', content: 'PRIVATE_USER_TEXT' }], journal: { version: 1, turns: [{ id: 't', sequence: 1, startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:01.000Z', status: 'completed', userMessageIndex: 0, assistantMessageIndex: 1, attempts: [{ attempt: 1, step: 0, startedAt: 'now', endedAt: 'now', status: 'succeeded', request: snapshot }], actions: [{ type: 'tool', step: 0, callId: 'c', tool: 'read_text_file', ok: true }] }] } }, availableCommands: [] });
    const text = Buffer.concat(chunks).toString();
    expect(text).toContain('Turn 1');
    expect(text).toContain('read_text_file');
    expect(text).not.toContain('PRIVATE_USER_TEXT');
  });
});

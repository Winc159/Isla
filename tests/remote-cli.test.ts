import { describe, expect, it } from 'vitest';
import { parseRemoteCliInvocation } from '../src/client/remote-cli.js';

describe('remote CLI invocation', () => {
  it('opens the full interactive CLI without arguments', () => expect(parseRemoteCliInvocation([], '/workspace')).toMatchObject({ mode: 'local' }));
  it('treats positional text as a quick prompt', () => expect(parseRemoteCliInvocation(['帮我', '总结一下'], '/workspace')).toEqual({ mode: 'remote', prompt: '帮我 总结一下', newSession: false, workspaceRoot: '/workspace' }));
  it('supports new sessions and an explicit local escape hatch', () => {
    expect(parseRemoteCliInvocation(['--new', 'hello'], '/workspace')).toMatchObject({ mode: 'remote', prompt: 'hello', newSession: true });
    expect(parseRemoteCliInvocation(['--local'], '/workspace')).toMatchObject({ mode: 'local' });
  });
  it('routes service commands separately', () => expect(parseRemoteCliInvocation(['service', 'status'], '/workspace')).toMatchObject({ mode: 'service', serviceArgs: ['status'] }));
});

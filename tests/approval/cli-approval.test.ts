/// <reference types="node" />

import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CliApprovalService } from '../../src/approval/cli-approval.js';

describe('CLI approval interaction', () => {
  it('notifies the CLI to pause and resume its loading indicator', async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_enabled: boolean) => undefined });
    const output = new PassThrough();
    const lifecycle: string[] = [];
    const service = new CliApprovalService(input, output, () => lifecycle.push('pause'), () => lifecycle.push('resume'));

    const decision = service.request({ toolName: 'write_text_file', permission: { kind: 'filesystem-write' }, summary: 'write test' });
    input.write('y');

    await expect(decision).resolves.toEqual({ approved: true });
    expect(lifecycle).toEqual(['pause', 'resume']);
  });
});

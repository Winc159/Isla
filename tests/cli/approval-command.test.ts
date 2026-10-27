import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilePolicyStore } from '../../src/approval/policy.js';
import { approvalCommand } from '../../src/cli/approval-command.js';
import type { CliCommandContext } from '../../src/cli/command.js';

describe('/approval command', () => {
  it('adds an exact command rule, lists it and revokes it', async () => {
    const chunks: string[] = []; const output = new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback(); } });
    const policyStore = new FilePolicyStore(join(await mkdtemp(join(tmpdir(), 'isla-cli-approval-')), 'rules.json'));
    const context = (commandLine: string) => ({ commandLine, output, policyStore } as unknown as CliCommandContext);
    await approvalCommand.execute(context('/approval add command-execute run_command D:/Private/Isla ["node","--version"]'));
    const [rule] = await policyStore.list();
    expect(rule).toMatchObject({ effect: 'allow', permission: 'command-execute', tool: 'run_command', workspace: 'D:/Private/Isla', commandPrefix: ['node', '--version'] });
    await approvalCommand.execute(context('/approval list'));
    expect(chunks.join('')).toContain(rule!.id);
    await approvalCommand.execute(context(`/approval revoke ${rule!.id}`));
    expect(await policyStore.list()).toEqual([]);
  });
  it('requires command rules to carry a nonempty argv prefix', async () => {
    const chunks: string[] = []; const output = new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback(); } });
    const policyStore = new FilePolicyStore(join(await mkdtemp(join(tmpdir(), 'isla-cli-approval-')), 'rules.json'));
    await approvalCommand.execute({ commandLine: '/approval add command-execute run_command .', output, policyStore } as unknown as CliCommandContext);
    expect(await policyStore.list()).toEqual([]); expect(chunks.join('')).toContain('必须限定 argv 前缀');
  });
  it('adds hostname-scoped network rules and rejects URL-shaped host input', async () => {
    const chunks: string[] = []; const output = new Writable({ write(chunk, _encoding, callback) { chunks.push(String(chunk)); callback(); } });
    const policyStore = new FilePolicyStore(join(await mkdtemp(join(tmpdir(), 'isla-cli-approval-')), 'rules.json'));
    const context = (commandLine: string) => ({ commandLine, output, policyStore } as unknown as CliCommandContext);
    await approvalCommand.execute(context('/approval add network web_fetch Docs.Example.com.'));
    expect(await policyStore.list()).toMatchObject([{ permission: 'network', tool: 'web_fetch', networkHost: 'docs.example.com' }]);
    await approvalCommand.execute(context('/approval add network web_fetch https://docs.example.com:443/path'));
    expect(await policyStore.list()).toHaveLength(1);
    expect(chunks.join('')).toContain('精确 hostname');
  });

  it('supports a separate download-host rule and dependency installation scope', async () => {
    const output = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    const policyStore = new FilePolicyStore(join(await mkdtemp(join(tmpdir(), 'isla-cli-approval-')), 'rules.json'));
    const context = (commandLine: string) => ({ commandLine, output, policyStore } as unknown as CliCommandContext);
    await approvalCommand.execute(context('/approval add network-download dependency_install artifacts.example.com'));
    await approvalCommand.execute(context('/approval add dependency-install dependency_install D:/work'));
    expect(await policyStore.list()).toMatchObject([
      { permission: 'network-download', tool: 'dependency_install', networkHost: 'artifacts.example.com' },
      { permission: 'dependency-install', tool: 'dependency_install', workspace: 'D:/work' },
    ]);
  });
});

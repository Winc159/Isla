import { describe, expect, it } from 'vitest';
import { evaluatePolicy } from '../../src/approval/policy.js';
import { FilePolicyStore } from '../../src/approval/policy.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('approval policy evaluator', () => {
  const request = { permission: { kind: 'command-execute' } as const, tool: 'run_command', workspace: 'C:\\work', argv: ['node', 'test.mjs'] };
  it('matches tool, permission, workspace and argv as separate fields', () => {
    expect(evaluatePolicy([{ id: 'allow-tests', effect: 'allow', tool: 'run_command', permission: 'command-execute', workspace: 'c:/WORK', commandPrefix: ['node', 'test.mjs'] }], request)).toEqual({ effect: 'allow', ruleId: 'allow-tests' });
    expect(evaluatePolicy([{ id: 'allow-node', effect: 'allow', commandPrefix: ['node'] }], { ...request, argv: ['node', 'deploy.mjs'] })).toEqual({ effect: 'allow', ruleId: 'allow-node' });
    expect(evaluatePolicy([{ id: 'allow-node', effect: 'allow', commandPrefix: ['node', 'test.mjs'] }], { ...request, argv: ['node', 'test.mjs.evil'] })).toEqual({ effect: 'ask' });
  });
  it('ignores expired rules and defaults to ask', () => {
    expect(evaluatePolicy([{ id: 'expired', effect: 'allow', expiresAt: '2020-01-01T00:00:00.000Z' }], { ...request, now: Date.parse('2026-01-01T00:00:00.000Z') })).toEqual({ effect: 'ask' });
    expect(evaluatePolicy([{ id: 'deny', effect: 'deny', permission: 'network' }], request)).toEqual({ effect: 'ask' });
  });
  it('prioritizes an explicit deny over a broader allow rule', () => {
    const rules = [
      { id: 'broad-allow', effect: 'allow', permission: 'command-execute' },
      { id: 'specific-deny', effect: 'deny', tool: 'run_command', commandPrefix: ['node', 'deploy.mjs'] },
    ] as const;
    expect(evaluatePolicy(rules, { ...request, argv: ['node', 'deploy.mjs'] })).toEqual({ effect: 'deny', ruleId: 'specific-deny' });
  });
  it('matches persistent network approvals by exact normalized hostname', () => {
    const rule = { id: 'allow-docs-host', effect: 'allow', permission: 'network', tool: 'web_fetch', networkHost: 'docs.example.com' } as const;
    expect(evaluatePolicy([rule], { permission: { kind: 'network' }, tool: 'web_fetch', workspace: '', networkHost: 'DOCS.EXAMPLE.COM.' })).toEqual({ effect: 'allow', ruleId: rule.id });
    expect(evaluatePolicy([rule], { permission: { kind: 'network' }, tool: 'web_fetch', workspace: '', networkHost: 'other.example.com' })).toEqual({ effect: 'ask' });
    expect(evaluatePolicy([rule], { permission: { kind: 'network' }, tool: 'web_fetch', workspace: '' })).toEqual({ effect: 'ask' });
  });
  it('persists, replaces and revokes rules', async () => {
    const store = new FilePolicyStore(join(await mkdtemp(join(tmpdir(), 'isla-approval-')), 'rules.json'));
    await store.put({ id: 'r1', effect: 'allow', permission: 'command-execute' });
    await store.put({ id: 'r1', effect: 'deny', permission: 'command-execute' });
    expect(await store.list()).toEqual([{ id: 'r1', effect: 'deny', permission: 'command-execute' }]);
    expect(await store.revoke('r1')).toBe(true);
    expect(await store.revoke('r1')).toBe(false);
  });
});

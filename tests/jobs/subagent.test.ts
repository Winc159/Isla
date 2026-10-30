import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JobRuntime } from '../../src/jobs/runtime.js';
import { JobStore } from '../../src/jobs/store.js';
import { createSubagentCapability } from '../../src/tools/subagent.js';
import { AgentRegistry, RuntimeScope } from '../../src/core/service-kernel.js';
import { createSessionFactory } from '../../src/runtime/session-factory.js';
import { IslaRuntime } from '../../src/core/runtime.js';
import { FakeProvider } from '../support/fake-provider.js';
import type { StoredSession } from '../../src/sessions/store.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
describe('restricted Subagent', () => {
  it('persists a delegated Job and returns its structured result to its owner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'isla-subagent-')); roots.push(root);
    const jobs = new JobRuntime(new JobStore(join(root, 'jobs.sqlite'))); jobs.register('subagent', async () => ({ summary: 'two sources checked', evidence: ['source-1','source-2'], artifacts: [], limitations: [] })); await jobs.start();
    const capability = createSubagentCapability({ jobs, parentAgentId: 'agent-parent', parentSessionId: 'session-parent', workspaceRoot: root, canCreate: () => true });
    const create = capability.tools.find(tool => tool.definition.name === 'subagent_create')!;
    const created = JSON.parse(await create.execute(JSON.stringify({ objective: 'Compare these two read-only sources.' }), { toolCallId: 'call-1' })) as { jobId: string };
    const wait = capability.tools.find(tool => tool.definition.name === 'subagent_wait')!;
    const result = JSON.parse(await wait.execute(JSON.stringify({ jobId: created.jobId, timeoutMs: 10_000 }))) as { job: { status: string; result: { summary: string; evidence: string[] } } };
    expect(result.job.status).toBe('completed'); expect(result.job.result.summary).toBe('two sources checked'); expect(result.job.result.evidence).toHaveLength(2);
    await jobs.close();
  });

  it('rejects nested creation and exposes only read-only project tools in job mode', async () => {
    const scope = new RuntimeScope('host', 'host'); const registry = new AgentRegistry(scope);
    const runtime = new IslaRuntime().use({ name: 'fake', setup: context => { const provider = new FakeProvider([{ text: 'done' }]); Object.assign(provider, { capabilities: { toolCalling: true, nativeStreaming: false, streamingToolCalls: false }, generateWithTools: async () => ({ text: 'done' }) }); context.registerProvider(provider); } });
    const stored: StoredSession = { version: 5, id: 'child-session', createdAt: 'now', updatedAt: 'now', provider: 'fake', model: 'fake-model', workspaceKey: 'workspace', messages: [], journal: { version: 1, turns: [] }, skillCatalog: { version: 1, entries: [] } };
    const factory = createSessionFactory({ runtime, config: { provider: 'fake', model: 'fake-model', maxContextTurns: 8, maxContextChars: 20_000, contextRetainTurns: 4, maxContextTokens: 8_000, maxOutputTokens: 1_000, contextReserveTokens: 1_000, modelRetries: 0 }, sessionStore: {} as never, workspaceRoot: process.cwd(), agentRegistry: registry });
    const session = factory.create({ stored, interactive: false, jobMode: true, approvalPolicy: 'never' });
    const names = ((session as unknown as { capabilities: readonly { tools: readonly { definition: { name: string } }[] }[] }).capabilities).flatMap(capability => capability.tools.map(tool => tool.definition.name));
    expect(names.length).toBeGreaterThan(0);
    expect(names.every(name => ['read_text_file','list_directory','glob_project','grep_project','search_project','web_fetch','web_search'].includes(name))).toBe(true);
    expect(names).not.toContain('write_text_file'); expect(names).not.toContain('run_command'); expect(names).not.toContain('subagent_create');
    await factory.dispose(session); await registry.close(); await scope.close();
  });
});

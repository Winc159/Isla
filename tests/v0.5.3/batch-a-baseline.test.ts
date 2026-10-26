import { describe, expect, it } from 'vitest';
import { createSessionFactory } from '../../src/runtime/session-factory.js';
import { IslaRuntime } from '../../src/core/runtime.js';
import { FakeProvider } from '../support/fake-provider.js';
import { LoopBudgetState, DEFAULT_AUTO_STEP_LIMIT, DEFAULT_EXTENSION_STEPS, DEFAULT_HARD_STEP_LIMIT, DEFAULT_INITIAL_STEP_BUDGET } from '../../src/core/loop-budget.js';
import { evaluateCompletionGate } from '../../src/core/completion-gate.js';

describe('v0.5.3 Batch A baseline', () => {
  it('freezes the current bounded loop contract before planner changes', () => {
    expect({ DEFAULT_INITIAL_STEP_BUDGET, DEFAULT_EXTENSION_STEPS, DEFAULT_AUTO_STEP_LIMIT, DEFAULT_HARD_STEP_LIMIT })
      .toEqual({ DEFAULT_INITIAL_STEP_BUDGET: 12, DEFAULT_EXTENSION_STEPS: 8, DEFAULT_AUTO_STEP_LIMIT: 28, DEFAULT_HARD_STEP_LIMIT: 40 });
    const state = new LoopBudgetState();
    expect(state.tryExtend()).toBe(true);
    expect(state.tryExtend()).toBe(true);
    expect(state.tryExtend()).toBe(false);
    expect(state.currentBudget).toBe(28);
    expect(state.extendAfterApproval()).toBe(true);
    expect(state.extendAfterApproval()).toBe(true);
    expect(state.currentBudget).toBe(40);
    expect(state.extendAfterApproval()).toBe(false);
  });

  it('freezes repeated-failure and completion-gate closure behavior', () => {
    const state = new LoopBudgetState();
    for (let index = 0; index < 3; index += 1) state.record({ action: 'browser_open:{}', result: `EPERM-${index}`, changed: false, errorCode: 'EXECUTION_FAILED' });
    expect(state.shouldStop()).toBe(true);
    expect(evaluateCompletionGate({ toolCallIds: ['call-1'], toolResultIds: [] })).toMatchObject({ accepted: false, reason: 'tool_result_missing' });
    expect(evaluateCompletionGate({ unapprovedActionCount: 1 })).toMatchObject({ accepted: false, reason: 'approval_missing' });
  });

  it('wires a real capability resolver into factory-created sessions', async () => {
    const runtime = new IslaRuntime().use({ name: 'fake', setup: context => context.registerProvider(new FakeProvider([{ text: 'ok' }])) });
    const factory = createSessionFactory({
      runtime,
      config: { provider: 'fake', model: 'fake-model', maxContextTurns: 8, maxContextChars: 20_000, contextRetainTurns: 4, maxContextTokens: 8_000, maxOutputTokens: 1_000, contextReserveTokens: 1_000, modelRetries: 0 },
      sessionStore: {} as never,
      workspaceRoot: process.cwd(),
    });
    const session = factory.create({
      interactive: false,
      stored: { version: 1, id: 'baseline', createdAt: 'now', updatedAt: 'now', provider: 'fake', model: 'fake-model', messages: [] },
    });
    expect(factory.capabilityCatalog().list().length).toBeGreaterThan(0);
    expect((session as unknown as { resolveCapabilities?: unknown }).resolveCapabilities).toBeTypeOf('function');
    const resolved = await (session as unknown as { resolveCapabilities: (input: string, step: number, signal: AbortSignal) => Promise<readonly { id: string }[]> }).resolveCapabilities('读取项目文件', 0, new AbortController().signal);
    expect(resolved.some(capability => capability.id === 'capability-routing')).toBe(true);
    expect(resolved.map(capability => capability.id)).toEqual(expect.arrayContaining([
      'control', 'project-files', 'project-discovery', 'command-execution', 'task-state',
    ]));
  });
});

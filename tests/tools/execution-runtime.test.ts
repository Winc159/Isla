import { describe, expect, it } from 'vitest';
import { ExecutionProcessRegistry } from '../../src/tools/process-registry.js';
import { createExecutionRuntimeCapability } from '../../src/tools/execution-runtime.js';

describe('execution runtime capability', () => {
  it('exposes environment facts without revealing PATH and supports bounded availability checks', async () => {
    const capability = createExecutionRuntimeCapability(new ExecutionProcessRegistry(), process.cwd(), () => 'test-session');
    const tool = capability.tools.find(candidate => candidate.definition.name === 'exec_environment')!;
    const output = await tool.execute(JSON.stringify({ commands: ['node', `isla-missing-${process.pid}`] }));
    const value = JSON.parse(typeof output === 'string' ? output : output.content) as { platform: string; architecture: string; pathEntryCount: number; commands: { command: string; available: boolean }[] };
    expect(value.platform).toBe(process.platform);
    expect(value.architecture).toBe(process.arch);
    expect(value.pathEntryCount).toBeGreaterThan(0);
    expect(JSON.stringify(value)).not.toContain(process.env.PATH);
    expect(value.commands).toEqual([{ command: 'node', available: true }, { command: `isla-missing-${process.pid}`, available: false }]);
    await expect(tool.execute(JSON.stringify({ commands: ['../secret'] }))).rejects.toThrow();
  });
});

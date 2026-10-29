import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionProcessRegistry } from '../../src/tools/process-registry.js';

describe('ExecutionProcessRegistry', () => {
  let registry: ExecutionProcessRegistry | undefined;
  let workspace: string | undefined;
  afterEach(async () => {
    await registry?.close(); registry = undefined;
    if (workspace) await rm(workspace, { recursive: true, force: true });
    workspace = undefined;
  });
  async function setup() { workspace = await mkdtemp(join(tmpdir(), 'isla-exec-')); registry = new ExecutionProcessRegistry(); return { workspace, registry }; }

  it('captures output, returns monotonic cursors, and records exit state', async () => {
    const { workspace: root, registry: processes } = await setup();
    const started = await processes.start({ workspaceRoot: root, executable: process.execPath, argv: ['-e', "console.log('first'); console.error('second')"] });
    await waitFor(() => processes.status(started.processId)?.state === 'exited' && processes.status(started.processId)?.outputBytes > 0);
    const result = processes.read(started.processId, 0);
    expect(result.events.map(event => event.text).join('')).toContain('first');
    expect(result.events.some(event => event.stream === 'stderr' && event.text.includes('second'))).toBe(true);
    expect(result.cursor).toBeGreaterThan(0);
    expect(processes.status(started.processId)?.state).toBe('exited');
    expect(processes.status(started.processId)?.outputBytes).toBeGreaterThan(0);
    expect(processes.read(started.processId, result.cursor).events).toEqual([]);
  });

  it('preserves UTF-8 across chunks and makes large output incrementally readable', async () => {
    const { workspace: root, registry: processes } = await setup();
    const started = await processes.start({ workspaceRoot: root, executable: process.execPath, argv: ['-e', "process.stdout.write(Buffer.from([0xe4,0xb8])); setTimeout(() => { process.stdout.write(Buffer.from([0xad])); process.stdout.write('x'.repeat(100000)); }, 20)"] });
    await waitFor(() => (processes.status(started.processId)?.outputBytes ?? 0) >= 100_000);
    const first = processes.read(started.processId, 0, 4096);
    const all = [...first.events];
    let cursor = first.cursor;
    while (cursor < (processes.status(started.processId)?.outputCursor ?? 0)) {
      const next = processes.read(started.processId, cursor, 64_000);
      all.push(...next.events);
      if (next.cursor === cursor) break;
      cursor = next.cursor;
    }
    expect(all.map(event => event.text).join('')).toContain('中');
    expect(all.map(event => event.text).join('')).toContain('x'.repeat(1000));
    expect(first.events.reduce((sum, event) => sum + Buffer.byteLength(event.text), 0)).toBeLessThanOrEqual(4096);
  });

  it('accepts bounded stdin and permits cancellation of a live process', async () => {
    const { workspace: root, registry: processes } = await setup();
    const started = await processes.start({ workspaceRoot: root, executable: process.execPath, argv: ['-e', "process.stdin.on('data', x => { console.log(x.toString()); process.exit(0) })"] });
    processes.write(started.processId, 'hello\n');
    await waitFor(() => processes.status(started.processId)?.state === 'exited' && processes.status(started.processId)?.outputBytes > 0);
    expect(processes.read(started.processId).events.map(event => event.text).join('')).toContain('hello');
    const long = await processes.start({ workspaceRoot: root, executable: process.execPath, argv: ['-e', 'setInterval(() => {}, 1000)'] });
    expect((await processes.cancel(long.processId)).state).toBe('cancelled');
  });

  it('supports an interactive PTY process and reports runtime facts', async () => {
    const { workspace: root, registry: processes } = await setup();
    const executable = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : process.execPath;
    const argv = process.platform === 'win32' ? ['/d', '/c', 'echo hello'] : ['-e', "console.log('hello')"];
    const started = await processes.start({ workspaceRoot: root, executable, argv, tty: true });
    expect(started.tty).toBe(true);
    expect(started.adapter).toBe('local');
    await waitFor(() => processes.status(started.processId)?.state === 'exited' && processes.status(started.processId)?.outputBytes > 0);
    expect(processes.read(started.processId).events.map(event => event.text).join('')).toContain('hello');
    expect(processes.status(started.processId)?.state).toBe('exited');
    expect(processes.status(started.processId)?.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('resolves managed-toolchain executables by registered IDs only', async () => {
    const { workspace: root } = await setup();
    let requested = '';
    const processes = new ExecutionProcessRegistry({ resolveManagedExecutable: async (dependencyId, executableId) => { requested = `${dependencyId}/${executableId}`; return process.execPath; } });
    registry = processes;
    const started = await processes.start({ workspaceRoot: root, adapter: 'managed-toolchain', dependencyId: 'node-runtime', executableId: 'bin/node', executable: 'node', argv: ['--version'] });
    expect(requested).toBe('node-runtime/bin/node');
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(processes.status(started.processId)?.adapter).toBe('managed-toolchain');
    expect(processes.read(started.processId).events.map(event => event.text).join('')).toMatch(/v\d+\.\d+\.\d+/u);
  });

  it('fails closed if a container adapter is requested without pinned configuration', async () => {
    const { workspace: root, registry: processes } = await setup();
    await expect(processes.start({ workspaceRoot: root, adapter: 'container', executable: 'node', argv: ['--version'] })).rejects.toThrow('CONTAINER_ADAPTER_UNAVAILABLE');
    expect(() => new ExecutionProcessRegistry({ container: { engine: 'docker', image: 'node:latest' } })).toThrow('CONTAINER_IMAGE_MUST_BE_DIGEST_PINNED');
  });

  it('isolates process access by session owner', async () => {
    const { workspace: root, registry: processes } = await setup();
    const started = await processes.start({ workspaceRoot: root, ownerId: 'session-a', executable: process.execPath, argv: ['-e', 'setInterval(() => {}, 1000)'] });
    expect(processes.list('session-a').map(item => item.processId)).toContain(started.processId);
    expect(processes.list('session-b')).toEqual([]);
    expect(processes.status(started.processId, 'session-b')).toBeUndefined();
    expect(() => processes.read(started.processId, 0, 100, 'session-b')).toThrow('PROCESS_NOT_FOUND');
    await expect(processes.cancel(started.processId, 'session-b')).rejects.toThrow('PROCESS_NOT_FOUND');
    expect(processes.status(started.processId, 'session-a')?.state).toBe('running');
  });

  it('closes processes belonging to one session without affecting another', async () => {
    const { workspace: root, registry: processes } = await setup();
    const first = await processes.start({ workspaceRoot: root, ownerId: 'session-a', executable: process.execPath, argv: ['-e', 'setInterval(() => {}, 1000)'] });
    const second = await processes.start({ workspaceRoot: root, ownerId: 'session-b', executable: process.execPath, argv: ['-e', 'setInterval(() => {}, 1000)'] });
    await processes.closeOwner('session-a');
    expect(processes.status(first.processId, 'session-a')?.state).toBe('cancelled');
    expect(processes.status(second.processId, 'session-b')?.state).toBe('running');
  });

  it('rejects workdirs outside the workspace and exposes timeout as a terminal state', async () => {
    const { workspace: root, registry: processes } = await setup();
    await expect(processes.start({ workspaceRoot: root, workdir: tmpdir(), executable: process.execPath, argv: ['--version'] })).rejects.toThrow('WORKDIR_INVALID');
    const outside = await mkdtemp(join(tmpdir(), 'isla-outside-'));
    try {
      await symlink(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
      await expect(processes.start({ workspaceRoot: root, workdir: 'escape', executable: process.execPath, argv: ['--version'] })).rejects.toThrow('WORKDIR_INVALID');
    } finally { await rm(outside, { recursive: true, force: true }); }
    const started = await processes.start({ workspaceRoot: root, executable: process.execPath, argv: ['-e', 'setInterval(() => {}, 1000)'], timeoutMs: 30 });
    await new Promise(resolve => setTimeout(resolve, 450));
    expect(processes.status(started.processId)?.state).toBe('timed_out');
  });
});

async function waitFor(condition: () => boolean | undefined, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('PROCESS_TEST_CONDITION_TIMEOUT');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

import { spawn, type ChildProcess } from 'node:child_process';
import type { IPty } from 'node-pty';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { scrubEnvironment, resolveWorkdir } from './subprocess-runner.js';
import { buildContainerInvocation } from './container-adapter.js';

export type ManagedProcessState = 'running' | 'exited' | 'failed' | 'cancelled' | 'timed_out';
export type ExecutionAdapterId = 'local' | 'managed-toolchain' | 'container';
export interface ExecutionProcessRegistryOptions {
  readonly defaultAdapter?: ExecutionAdapterId;
  readonly container?: { readonly engine: 'docker' | 'podman'; readonly image: string };
  readonly resolveManagedExecutable?: (dependencyId: string, executableId: string) => Promise<string>;
}
export interface ProcessOutputEvent { readonly sequence: number; readonly stream: 'stdout' | 'stderr'; readonly text: string; }
export interface ManagedProcessStatus {
  readonly processId: string; readonly state: ManagedProcessState; readonly executable: string; readonly argv: readonly string[];
  readonly workdir: string; readonly startedAt: string; readonly endedAt?: string; readonly exitCode?: number | null;
  readonly signal?: NodeJS.Signals | null; readonly errorCode?: string; readonly outputCursor: number;
  readonly tty: boolean; readonly adapter: ExecutionAdapterId; readonly elapsedMs: number; readonly outputBytes: number;
}
interface ManagedProcess {
  readonly child?: ChildProcess; readonly pty?: IPty; readonly ownerId?: string; readonly workspaceRoot: string; readonly executable: string; readonly argv: readonly string[];
  readonly workdir: string; readonly startedAt: string; readonly events: ProcessOutputEvent[]; readonly stdoutDecoder: StringDecoder; readonly stderrDecoder: StringDecoder; eventBytes: number; totalOutputBytes: number; sequence: number;
  state: ManagedProcessState; endedAt?: string; exitCode?: number | null; signal?: NodeJS.Signals | null; errorCode?: string;
  readonly tty: boolean; readonly adapter: ExecutionAdapterId;
  timer?: NodeJS.Timeout; termination?: Promise<void>;
}

const MAX_LIVE_PROCESSES = 16;
const MAX_RETAINED_PROCESSES = 256;
const MAX_PROCESS_OUTPUT_BYTES = 256_000;
const MAX_PROCESS_OUTPUT_EVENTS = 4_096;
const MAX_PROCESS_EVENT_BYTES = 4_096;
const MAX_WRITE_BYTES = 16_000;
const DEFAULT_PROCESS_TIMEOUT_MS = 10 * 60_000;
const TERMINATION_GRACE_MS = 300;

export class ExecutionProcessRegistry {
  private readonly processes = new Map<string, ManagedProcess>();
  private closed = false;
  constructor(private readonly options: ExecutionProcessRegistryOptions = {}) {
    if (options.container && !/^[A-Za-z0-9._/:+-]+@sha256:[a-f0-9]{64}$/iu.test(options.container.image)) throw new Error('CONTAINER_IMAGE_MUST_BE_DIGEST_PINNED');
  }

  async start(input: { readonly workspaceRoot: string; readonly executable: string; readonly argv: readonly string[]; readonly ownerId?: string; readonly workdir?: string; readonly timeoutMs?: number; readonly tty?: boolean; readonly adapter?: ExecutionAdapterId; readonly dependencyId?: string; readonly executableId?: string }): Promise<ManagedProcessStatus> {
    if (this.closed) throw new Error('EXECUTION_RUNTIME_CLOSED');
    if ([...this.processes.values()].filter(entry => entry.state === 'running').length >= MAX_LIVE_PROCESSES) throw new Error('PROCESS_LIMIT_REACHED');
    if (this.processes.size >= MAX_RETAINED_PROCESSES) {
      const oldest = [...this.processes.entries()].find(([, entry]) => entry.endedAt);
      if (oldest) this.processes.delete(oldest[0]); else throw new Error('PROCESS_LIMIT_REACHED');
    }
    if (!input.executable.trim() || input.argv.length > 256 || input.argv.some(argument => typeof argument !== 'string' || Buffer.byteLength(argument, 'utf8') > 16_000)) throw new Error('EXEC_ARGUMENTS_INVALID');
    let workdir: string;
    try {
      const candidate = await resolveWorkdir(input.workspaceRoot, input.workdir ?? '');
      const [canonicalRoot, canonicalWorkdir] = await Promise.all([realpath(input.workspaceRoot), realpath(candidate)]);
      const relativeWorkdir = relative(canonicalRoot, canonicalWorkdir);
      if (relativeWorkdir === '..' || relativeWorkdir.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(relativeWorkdir)) throw new Error('WORKDIR_INVALID');
      workdir = canonicalWorkdir;
    }
    catch { throw new Error('WORKDIR_INVALID'); }
    const adapter = input.adapter ?? this.options.defaultAdapter ?? 'local';
    const canonicalRoot = await realpath(input.workspaceRoot);
    let executable = input.executable;
    let argv = [...input.argv];
    let processCwd = workdir;
    let processEnv = scrubEnvironment();
    if (adapter === 'managed-toolchain') {
      if (!input.dependencyId || !input.executableId || !this.options.resolveManagedExecutable) throw new Error('MANAGED_TOOLCHAIN_UNAVAILABLE');
      executable = await this.options.resolveManagedExecutable(input.dependencyId, input.executableId);
    } else if (adapter === 'container') {
      const container = this.options.container;
      if (!container) throw new Error('CONTAINER_ADAPTER_UNAVAILABLE');
      const invocation = buildContainerInvocation({ ...container, workspaceRoot: canonicalRoot, workdir, executable: input.executable, argv: input.argv });
      executable = invocation.executable;
      argv = [...invocation.argv];
      processCwd = invocation.cwd;
      processEnv = scrubEnvironment();
    }
    const timeoutMs = input.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('EXEC_TIMEOUT_INVALID');
    const pty = input.tty ? (await import('node-pty')).spawn(executable, argv, { cwd: processCwd, env: processEnv as Record<string, string>, cols: 100, rows: 30, ...(process.platform === 'win32' ? { useConpty: false } : {}) }) : undefined;
    const child = input.tty ? undefined : spawn(executable, argv, { cwd: processCwd, env: processEnv, shell: false, detached: process.platform !== 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const processId = randomUUID();
    const entry: ManagedProcess = { ...(child ? { child } : {}), ...(pty ? { pty } : {}), ...(input.ownerId ? { ownerId: input.ownerId } : {}), workspaceRoot: input.workspaceRoot, executable: input.executable, argv: [...input.argv], workdir, startedAt: new Date().toISOString(), events: [], stdoutDecoder: new StringDecoder('utf8'), stderrDecoder: new StringDecoder('utf8'), eventBytes: 0, totalOutputBytes: 0, sequence: 0, state: 'running', tty: input.tty === true, adapter };
    this.processes.set(processId, entry);
    if (pty) {
      pty.onData(data => this.append(entry, 'stdout', data));
      pty.onExit(event => this.finish(entry, 'exited', event.exitCode, null));
    } else {
      child!.stdout?.on('data', chunk => this.append(entry, 'stdout', entry.stdoutDecoder.write(Buffer.from(chunk))));
      child!.stderr?.on('data', chunk => this.append(entry, 'stderr', entry.stderrDecoder.write(Buffer.from(chunk))));
      child!.once('error', error => this.finish(entry, 'failed', null, null, (error as NodeJS.ErrnoException).code ?? 'PROCESS_START_FAILED'));
      child!.once('close', (code, signal) => { this.append(entry, 'stdout', entry.stdoutDecoder.end()); this.append(entry, 'stderr', entry.stderrDecoder.end()); if (entry.state === 'running') this.finish(entry, 'exited', code, signal); });
    }
    entry.timer = setTimeout(() => { if (entry.state === 'running') { entry.state = 'timed_out'; void this.terminate(entry); } }, Math.min(timeoutMs, DEFAULT_PROCESS_TIMEOUT_MS));
    entry.timer.unref();
    return this.status(processId, input.ownerId)!;
  }

  read(processId: string, afterCursor = 0, limitBytes = 32_000, ownerId?: string): { readonly events: readonly ProcessOutputEvent[]; readonly cursor: number; readonly truncated: boolean } {
    const entry = this.get(processId, ownerId);
    if (!Number.isInteger(afterCursor) || afterCursor < 0 || !Number.isInteger(limitBytes) || limitBytes < MAX_PROCESS_EVENT_BYTES || limitBytes > 64_000) throw new Error('EXEC_READ_ARGUMENTS_INVALID');
    const available = entry.events.filter(event => event.sequence > afterCursor);
    let bytes = 0; const selected: ProcessOutputEvent[] = [];
    for (const event of available) {
      const size = Buffer.byteLength(event.text, 'utf8');
      if (bytes + size > limitBytes) break;
      selected.push(event); bytes += size;
    }
    const firstAvailable = entry.events[0]?.sequence ?? entry.sequence + 1;
    return { events: selected, cursor: selected.at(-1)?.sequence ?? afterCursor, truncated: afterCursor < firstAvailable - 1 };
  }

  write(processId: string, text: string, ownerId?: string): void {
    const entry = this.get(processId, ownerId);
    if (entry.state !== 'running' || (!entry.pty && !entry.child?.stdin?.writable)) throw new Error('PROCESS_NOT_WRITABLE');
    if (Buffer.byteLength(text, 'utf8') > MAX_WRITE_BYTES) throw new Error('PROCESS_INPUT_TOO_LARGE');
    if (entry.pty) entry.pty.write(text); else entry.child!.stdin!.write(text);
  }

  async cancel(processId: string, ownerId?: string): Promise<ManagedProcessStatus> {
    const entry = this.get(processId, ownerId);
    if (entry.state === 'running') { entry.state = 'cancelled'; await this.terminate(entry); }
    return this.status(processId)!;
  }

  status(processId: string, ownerId?: string): ManagedProcessStatus | undefined {
    const entry = this.processes.get(processId);
    if (!entry || entry.ownerId !== ownerId) return undefined;
    const endedAt = entry.endedAt;
    return { processId, state: entry.state, executable: entry.executable, argv: entry.argv, workdir: entry.workdir, startedAt: entry.startedAt, tty: entry.tty, adapter: entry.adapter, elapsedMs: Math.max(0, Date.parse(endedAt ?? new Date().toISOString()) - Date.parse(entry.startedAt)),
      ...(entry.endedAt ? { endedAt: entry.endedAt } : {}), ...(entry.exitCode !== undefined ? { exitCode: entry.exitCode } : {}),
      ...(entry.signal !== undefined ? { signal: entry.signal } : {}), ...(entry.errorCode ? { errorCode: entry.errorCode } : {}), outputCursor: entry.sequence, outputBytes: entry.totalOutputBytes };
  }

  list(ownerId: string): ManagedProcessStatus[] {
    return [...this.processes.keys()].map(processId => this.status(processId, ownerId)).filter((status): status is ManagedProcessStatus => status !== undefined);
  }

  async close(): Promise<void> {
    if (this.closed) return; this.closed = true;
    await this.terminateEntries([...this.processes.entries()]);
  }

  async closeOwner(ownerId: string): Promise<void> {
    const pending = [...this.processes.entries()].filter(([, entry]) => entry.ownerId === ownerId);
    await this.terminateEntries(pending);
  }

  private async terminateEntries(entries: readonly [string, ManagedProcess][]): Promise<void> {
    const pending = entries.filter(([, entry]) => entry.state === 'running' || entry.termination);
    await Promise.all(pending.map(async ([, entry]) => {
      if (entry.state === 'running') entry.state = 'cancelled';
      await this.terminate(entry);
    }));
  }

  private get(processId: string, ownerId?: string): ManagedProcess { const entry = this.processes.get(processId); if (!entry || entry.ownerId !== ownerId) throw new Error('PROCESS_NOT_FOUND'); return entry; }
  private append(entry: ManagedProcess, stream: 'stdout' | 'stderr', text: string): void {
    if (!text) return;
    let chunk = '';
    let chunkBytes = 0;
    const flush = () => {
      if (!chunk) return;
      const event = { sequence: ++entry.sequence, stream, text: chunk };
      entry.events.push(event); entry.eventBytes += chunkBytes;
      chunk = ''; chunkBytes = 0;
      while ((entry.eventBytes > MAX_PROCESS_OUTPUT_BYTES || entry.events.length > MAX_PROCESS_OUTPUT_EVENTS) && entry.events.length) entry.eventBytes -= Buffer.byteLength(entry.events.shift()!.text, 'utf8');
    };
    for (const character of text) {
      const size = Buffer.byteLength(character, 'utf8');
      entry.totalOutputBytes += size;
      if (chunkBytes + size > MAX_PROCESS_EVENT_BYTES) flush();
      chunk += character; chunkBytes += size;
    }
    flush();
  }
  private finish(entry: ManagedProcess, state: ManagedProcessState, exitCode: number | null, signal: NodeJS.Signals | null, errorCode?: string): void {
    if (entry.endedAt) return;
    if (entry.state === 'running') entry.state = state;
    entry.endedAt = new Date().toISOString(); entry.exitCode = exitCode; entry.signal = signal;
    if (errorCode) entry.errorCode = errorCode;
    if (entry.timer) clearTimeout(entry.timer);
  }
  private terminate(entry: ManagedProcess): Promise<void> {
    if (entry.termination) return entry.termination;
    entry.termination = new Promise(resolve => {
      const child = entry.child;
      const pty = entry.pty;
      if (entry.endedAt || (child && (child.exitCode !== null || child.signalCode !== null))) { this.finish(entry, entry.state, child?.exitCode ?? null, child?.signalCode ?? null); resolve(); return; }
      const settle = () => { if (!entry.endedAt) this.finish(entry, entry.state, child?.exitCode ?? null, child?.signalCode ?? null); resolve(); };
      if (pty) {
        const dispose = pty.onExit(() => { dispose.dispose(); settle(); });
        pty.kill();
        setTimeout(() => { if (!entry.endedAt) settle(); }, 1_000).unref();
      } else if (child) {
        child.once('close', settle);
        if (process.platform === 'win32' && child.pid) {
          const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
          killer.once('close', () => { try { child.kill(); } catch { /* already gone */ } });
          setTimeout(() => { if (!entry.endedAt) { try { child.kill(); } catch { /* already gone */ } } }, 1_000).unref();
        } else if (child.pid) {
          try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* already gone */ } }
          setTimeout(() => { if (!entry.endedAt && child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* process group exited */ } } }, TERMINATION_GRACE_MS).unref();
        }
      } else { settle(); }
    });
    return entry.termination;
  }
}

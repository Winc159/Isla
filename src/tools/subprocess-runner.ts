import { spawn } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { sandboxDenied } from "./errors.js";
import { createShellInvocation, type ShellInvocation } from "./shell-adapter.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_BYTES = 64_000;
const TERMINATION_GRACE_MS = 250;
const SENSITIVE_ENV_PATTERN = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|AUTHORIZATION|CREDENTIAL|COOKIE|SESSION/i;

export interface CommandRunRequest { readonly command: string; readonly workdir?: string; readonly timeoutMs?: number; readonly signal?: AbortSignal; }
export interface BoundedOutput { readonly text: string; readonly truncated: boolean; }
export interface CommandRunResult {
  readonly shell: ShellInvocation["shell"];
  readonly workdir: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly aborted: boolean;
  readonly stdout: BoundedOutput;
  readonly stderr: BoundedOutput;
}

export async function runCommand(workspaceRoot: string, request: CommandRunRequest): Promise<CommandRunResult> {
  if (!request.command.trim()) throw new Error("command must be a non-empty string");
  const workdir = await resolveWorkdir(workspaceRoot, request.workdir ?? "");
  const timeoutMs = clampTimeout(request.timeoutMs);
  const invocation = createShellInvocation(request.command);
  const stdout = new OutputCollector(MAX_OUTPUT_BYTES);
  const stderr = new OutputCollector(MAX_OUTPUT_BYTES);
  const child = spawn(invocation.argv[0]!, invocation.argv.slice(1), {
    cwd: workdir,
    env: scrubEnvironment(),
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let timedOut = false;
  let aborted = false;
  let terminating = false;
  const terminate = (): void => {
    if (terminating || child.exitCode !== null || child.signalCode !== null) return;
    terminating = true;
    if (process.platform === "win32" && child.pid) {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      try { child.kill(); } catch { /* taskkill 或子进程已经完成。 */ }
    } else if (child.pid) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch { /* 进程已退出，保持终止幂等。 */ } }
      setTimeout(() => { if (child.exitCode === null && child.signalCode === null && child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* 进程组已退出。 */ } } }, TERMINATION_GRACE_MS).unref();
    }
  };
  const onAbort = (): void => { aborted = true; terminate(); };
  request.signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
  try {
    child.stdout.on("data", chunk => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", chunk => stderr.push(Buffer.from(chunk)));
    const outcome = await new Promise<{ readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }>((resolveOutcome, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode, signal) => resolveOutcome({ exitCode, signal }));
    });
    return { shell: invocation.shell, workdir, ...outcome, timedOut, aborted, stdout: stdout.finalize(), stderr: stderr.finalize() };
  } catch (error) {
    throw new Error(`command process failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  } finally {
    clearTimeout(timeout);
    request.signal?.removeEventListener("abort", onAbort);
  }
}

export async function resolveWorkdir(workspaceRoot: string, workdir: string): Promise<string> {
  const root = resolve(workspaceRoot);
  if (workdir === "") return root;
  if (isAbsolute(workdir)) throw sandboxDenied("command workdir must be relative to the workspace");
  const candidate = resolve(root, workdir);
  const relativePath = relative(root, candidate);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) throw sandboxDenied("command workdir must stay inside the workspace");
  try {
    await access(candidate);
    if (!(await stat(candidate)).isDirectory()) throw sandboxDenied("command workdir must be a directory");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("command workdir")) throw error;
    throw sandboxDenied("command workdir does not exist");
  }
  return candidate;
}

export function scrubEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(source).filter(([name, value]) => value !== undefined && !SENSITIVE_ENV_PATTERN.test(name))) as NodeJS.ProcessEnv;
}

function clampTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(value) || value <= 0) throw new Error("timeoutMs must be a positive finite number");
  return Math.min(value, MAX_TIMEOUT_MS);
}

class OutputCollector {
  private chunks: Buffer[] = [];
  private bytes = 0;
  private wasTruncated = false;
  constructor(private readonly maxBytes: number) {}
  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.bytes += chunk.length;
    while (this.bytes > this.maxBytes) {
      const first = this.chunks[0]!;
      const excess = this.bytes - this.maxBytes;
      if (first.length <= excess) { this.chunks.shift(); this.bytes -= first.length; }
      else { this.chunks[0] = first.subarray(excess); this.bytes -= excess; }
      this.wasTruncated = true;
    }
  }
  finalize(): BoundedOutput { return { text: Buffer.concat(this.chunks).toString("utf8"), truncated: this.wasTruncated }; }
}

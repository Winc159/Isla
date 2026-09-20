import { spawn } from 'node-pty';

export interface PtyWaitOptions { readonly timeoutMs?: number; readonly from?: number; }
export interface PtyExit { readonly exitCode: number; readonly signal?: number; }

const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g;

export class PtyDriver {
  private readonly process: ReturnType<typeof spawn>;
  private output = '';
  private exited: Promise<PtyExit>;
  private exitResolve!: (value: PtyExit) => void;
  private disposed = false;
  private hasExited = false;

  constructor(command: string, args: string[], options: { readonly cwd: string; readonly env?: Record<string, string>; readonly cols?: number; readonly rows?: number }) {
    this.process = spawn(command, args, { name: 'xterm-color', cols: options.cols ?? 100, rows: options.rows ?? 30, cwd: options.cwd, env: options.env ?? process.env as Record<string, string> });
    this.exited = new Promise(resolve => { this.exitResolve = resolve; });
    this.process.onData(data => { this.output += data; });
    this.process.onExit(({ exitCode, signal }) => { this.hasExited = true; this.exitResolve({ exitCode, ...(signal ? { signal } : {}) }); });
  }

  get rawOutput(): string { return this.output; }
  get textOutput(): string { return normalizeTerminalText(this.output); }
  get isTTY(): boolean { return true; }
  write(text: string): void { this.process.write(text); }
  enter(command: string): void { this.write(`${command}\r`); }
  sendCtrlC(): void { this.write('\u0003'); }
  sendEscape(): void { this.write('\u001b'); }
  resize(cols: number, rows: number): void { this.process.resize(cols, rows); }

  async waitForText(text: string, options: PtyWaitOptions = {}): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const from = options.from ?? 0;
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (this.textOutput.slice(from).includes(text)) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`PTY text timeout: ${text}; output=${this.textOutput.slice(-2000)}`);
  }

  async waitForExit(timeoutMs = 10_000): Promise<PtyExit> {
    return Promise.race([
      this.exited,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`PTY exit timeout; output=${this.textOutput.slice(-2000)}`)), timeoutMs)),
    ]);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (!this.hasExited) { try { this.process.kill(); } catch { /* 进程已经退出时无需重复清理 */ } }
    await Promise.race([this.exited, new Promise(resolve => setTimeout(resolve, 2_000))]);
  }
}

export function normalizeTerminalText(value: string): string {
  return value.replace(ANSI, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

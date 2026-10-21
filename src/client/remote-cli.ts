import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { ResidentHostClient } from './host-client.js';
import { loadOrCreateLocalRuntimeConfig } from '../config/local-runtime.js';
import { workspaceKey } from '../sessions/workspace.js';
import { resolve } from 'node:path';

export interface RemoteCliInvocation {
  readonly mode: 'remote' | 'local' | 'service';
  readonly prompt?: string;
  readonly newSession: boolean;
  readonly workspaceRoot: string;
  readonly serviceArgs?: readonly string[];
}

export function parseRemoteCliInvocation(argv: readonly string[], cwd = process.cwd()): RemoteCliInvocation {
  if (argv[0] === 'service') return { mode: 'service', newSession: false, workspaceRoot: cwd, serviceArgs: argv.slice(1) };
  let local = false;
  let newSession = false;
  let workspaceRoot = cwd;
  const words: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--local') { local = true; continue; }
    if (arg === '--new') { newSession = true; continue; }
    if (arg === '--workspace') {
      const value = argv[++index];
      if (!value) throw new Error('--workspace requires a value');
      workspaceRoot = value;
      continue;
    }
    if (arg.startsWith('--')) return { mode: 'local', newSession: false, workspaceRoot: cwd };
    words.push(arg);
  }
  return { mode: local ? 'local' : 'remote', ...(words.length ? { prompt: words.join(' ') } : {}), newSession, workspaceRoot };
}

export async function runRemoteCli(invocation: RemoteCliInvocation, input: Readable = process.stdin, output: Writable = process.stdout): Promise<void> {
  const runtime = await loadOrCreateLocalRuntimeConfig();
  const client = new ResidentHostClient(`http://${runtime.host.host}:${runtime.host.port}`, runtime.host.token);
  try { await client.health(); }
  catch { throw new Error('Resident Host 未运行。请执行 isla service start，或使用 isla --local 临时运行。'); }
  const root = resolve(invocation.workspaceRoot);
  const key = workspaceKey(root);
  if (invocation.prompt) {
    const result = await client.quickPrompt(invocation.prompt, key, root, invocation.newSession);
    output.write(`${result.text}\n`);
    return;
  }
  output.write('Isla 已连接 Resident Host。输入 /new 开启新对话，输入 /exit 退出。\n');
  const lines = createInterface({ input, output, terminal: Boolean((input as Readable & { isTTY?: boolean }).isTTY) });
  let newSession = invocation.newSession;
  for await (const raw of lines) {
    const text = raw.trim();
    if (!text) continue;
    if (text === '/exit' || text === '/quit') break;
    if (text === '/new') { newSession = true; output.write('下一条消息将创建新对话。\n'); continue; }
    try {
      const result = await client.quickPrompt(text, key, root, newSession);
      newSession = false;
      output.write(`isla> ${result.text}\n`);
    } catch (error) { output.write(`Error: ${error instanceof Error ? error.message : '请求失败'}\n`); }
  }
}

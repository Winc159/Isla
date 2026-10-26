import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { ResidentHostClient } from './host-client.js';
import { loadOrCreateLocalRuntimeConfig } from '../config/local-runtime.js';
import { workspaceKey } from '../sessions/workspace.js';
import { resolve } from 'node:path';
import type { HostTurnEvent } from '../host/server.js';

async function runQuickPrompt(client: ResidentHostClient, text: string, key: string, root: string, newSession: boolean, output: Writable): Promise<void> {
  let active: { readonly sessionId: string; readonly turnId: string } | undefined;
  let cancelRequested = false;
  let cancelled = false;
  let sawDelta = false;
  let deltaText = '';
  const controller = new AbortController();
  const onSigint = () => {
    if (cancelRequested) { process.exitCode = 130; controller.abort(); return; }
    cancelRequested = true;
    output.write('\n正在取消本轮…\n');
    if (active) void client.cancel(active.sessionId, active.turnId);
  };
  process.on('SIGINT', onSigint);
  const onEvent = (event: HostTurnEvent) => {
    if (event.type === 'turn_start') {
      active = { sessionId: event.sessionId, turnId: event.turnId };
      if (cancelRequested) void client.cancel(event.sessionId, event.turnId);
    } else if (event.type === 'model_delta') {
      if (!sawDelta) output.write('isla> ');
      sawDelta = true;
      deltaText += event.text;
      output.write(event.text);
    } else if (event.type === 'tool_start') {
      if (sawDelta) output.write('\n');
      output.write(`[工具] ${event.tool} 开始\n`);
    } else if (event.type === 'tool_end') {
      output.write(`[工具] ${event.tool} ${event.ok ? '完成' : '未完成'}\n`);
    } else if (event.type === 'turn_completed') {
      if (!sawDelta) output.write(`isla> ${event.text}`);
      else if (event.text !== deltaText) output.write(`\n[最终回答]\n${event.text}`);
      output.write('\n');
    } else if (event.type === 'turn_cancelled') {
      cancelled = true;
    }
  };
  try {
    await client.quickPromptStream({ text, workspaceKey: key, workspaceRoot: root, newSession, onEvent, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.message === 'TURN_CANCELLED') cancelled = true;
    else if (controller.signal.aborted) cancelled = true;
    else throw error;
  } finally {
    process.off('SIGINT', onSigint);
    if (cancelled) process.exitCode = 130;
  }
}

export interface RemoteCliInvocation {
  readonly mode: 'remote' | 'local' | 'service';
  readonly prompt?: string;
  readonly newSession: boolean;
  readonly workspaceRoot: string;
  readonly serviceArgs?: readonly string[];
}

export function parseRemoteCliInvocation(argv: readonly string[], cwd = process.cwd()): RemoteCliInvocation {
  if (argv[0] === 'service') return { mode: 'service', newSession: false, workspaceRoot: cwd, serviceArgs: argv.slice(1) };
  // An empty invocation is the full interactive CLI. Positional text is the
  // intentionally short resident-host client path.
  if (argv.length === 0) return { mode: 'local', newSession: false, workspaceRoot: cwd };
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
    await runQuickPrompt(client, invocation.prompt, key, root, invocation.newSession, output);
    return;
  }
  output.write(`Isla v0 · Resident Host · workspace=${root}\nmaster,你好，我叫（Error划掉）Isla，很高兴认识你\n输入 /new 开启新对话，输入 /sessions 选择会话，输入 /exit 或按 Esc 退出。\n\n`);
  const lines = createInterface({ input, output, prompt: 'isla> ', terminal: Boolean((input as Readable & { isTTY?: boolean }).isTTY) });
  lines.prompt();
  let newSession = invocation.newSession;
  for await (const raw of lines) {
    const text = raw.trim();
    if (!text) continue;
    if (text === '/exit' || text === '/quit') break;
    if (text === '/new') { newSession = true; output.write('下一条消息将创建新对话。\n'); continue; }
    if (text === '/model' || text.startsWith('/model ')) {
      output.write('模型配置属于启动时会话，当前 Resident Host 会话不能直接切换。请退出后使用 /models use <model-id>，再输入 /new 或重新启动 Isla。\n');
      continue;
    }
    try {
      await runQuickPrompt(client, text, key, root, newSession, output);
      newSession = false;
      lines.prompt();
    } catch (error) { output.write(`Error: ${error instanceof Error ? error.message : '请求失败'}\n`); }
  }
}

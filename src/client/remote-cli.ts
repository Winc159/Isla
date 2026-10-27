import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { ResidentHostClient } from './host-client.js';
import { loadOrCreateLocalRuntimeConfig } from '../config/local-runtime.js';
import { workspaceKey } from '../sessions/workspace.js';
import { resolve } from 'node:path';
import type { HostTurnEvent } from '../host/server.js';
import { formatWorkspaceCheckpointPreview, type WorkspaceCheckpointPreview } from '../checkpoints/workspace-checkpoint.js';

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
  if (argv.length === 0) return { mode: 'remote', newSession: false, workspaceRoot: cwd };
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
  try { const health = await client.health() as { apiVersion?: number }; if (health.apiVersion !== 2) throw new Error('HOST_PROTOCOL_INCOMPATIBLE'); }
  catch (error) { if (error instanceof Error && error.message === 'HOST_PROTOCOL_INCOMPATIBLE') throw new Error('Resident Host 与 CLI 协议版本不兼容。请升级并重启 Resident Host，或使用 isla --local 临时恢复。'); throw new Error('Resident Host 未运行。请执行 isla service start，或使用 isla --local 临时运行。'); }
  const root = resolve(invocation.workspaceRoot);
  const key = workspaceKey(root);
  if (invocation.prompt) {
    await runQuickPrompt(client, invocation.prompt, key, root, invocation.newSession, output);
    return;
  }
  const listed = await client.sessions(key);
  let sessionId = invocation.newSession || !listed.sessions.length ? (await client.createSession(key)).sessionId : listed.sessions[0]!.sessionId;
  output.write(`Isla v0 · Resident Host · workspace=${root}\nmaster,你好，我叫（Error划掉）Isla，很高兴认识你\n当前会话 ${sessionId}\n输入 /new、/sessions、/plan、/checkpoint、/memory、/trace、/context 或 /exit。\n\n`);
  const lines = createInterface({ input, output, prompt: 'isla> ', terminal: Boolean((input as Readable & { isTTY?: boolean }).isTTY) });
  let busy = false;
  let active: { sessionId: string; turnId: string } | undefined;
  let interaction: { type: 'approval'; id: string } | { type: 'question'; id: string; questionIds: readonly string[] } | undefined;
  let controller: AbortController | undefined;
  let cancelRequested = false;
  const sigint = () => { if (!active) { lines.close(); return; } if (cancelRequested) { controller?.abort(); lines.close(); return; } cancelRequested = true; output.write('\n正在取消本轮…\n'); void client.cancel(active.sessionId, active.turnId); };
  process.on('SIGINT', sigint);
  const writeJson = (label: string, value: unknown) => output.write(`${label}\n${JSON.stringify(value, null, 2)}\n`);
  lines.on('line', raw => { void (async () => {
    const text = raw.trim(); if (!text) { lines.prompt(); return; }
    if (interaction && active) {
      const pending = interaction; interaction = undefined;
      try { const response = pending.type === 'approval' ? { approved: /^(y|yes|批准|允许)$/iu.test(text) } : { answers: pending.questionIds.map((id, index) => ({ id, selected: [], custom: text.split('|').map(value => value.trim())[index] ?? '' })) }; const result = await client.respond(active.sessionId, pending.id, active.turnId, response); if (!result.accepted) output.write('交互响应已过期或被拒绝。\n'); }
      catch (error) { output.write(`Error: ${error instanceof Error ? error.message : '响应失败'}\n`); }
      lines.prompt(); return;
    }
    if (busy) { output.write('当前 Turn 仍在运行；请先完成待处理审批/问题或等待结束。\n'); lines.prompt(); return; }
    if (text === '/exit' || text === '/quit') { lines.close(); return; }
    if (text === '/new') { sessionId = (await client.createSession(key)).sessionId; output.write(`已切换到新会话 ${sessionId}\n`); lines.prompt(); return; }
    if (text === '/sessions') { const result = await client.sessions(key); result.sessions.forEach((item, index) => output.write(`${index + 1}. ${item.sessionId}${item.sessionId === sessionId ? ' *' : ''} · ${item.updatedAt}\n`)); output.write('使用 /sessions select <序号或 ID> 切换；/sessions history 查看历史。\n'); lines.prompt(); return; }
    if (text.startsWith('/sessions select ')) { const result = await client.sessions(key); const choice = text.slice(17).trim(); const selected = result.sessions.find((item, index) => String(index + 1) === choice || item.sessionId === choice); if (!selected) output.write('未找到可用会话。\n'); else { sessionId = selected.sessionId; output.write(`已选择 ${sessionId}\n`); const history = await client.history(sessionId, 0, 20); for (const message of history.messages) output.write(`${message.role === 'user' ? '你' : 'Isla'}：${message.content}\n`); } lines.prompt(); return; }
    if (text === '/sessions history') { const history = await client.history(sessionId, 0, 50); for (const message of history.messages) output.write(`${message.role === 'user' ? '你' : 'Isla'}：${message.content}\n`); output.write(`（${history.messages.length}/${history.total} 条）\n`); lines.prompt(); return; }
    if (text === '/trace' || text === '/context') { writeJson(text, await client.sessionView(sessionId, text.slice(1) as 'trace' | 'context')); lines.prompt(); return; }
    if (text === '/plan') { writeJson('/plan', await client.workPlan(sessionId)); lines.prompt(); return; }
    if (text === '/plan approve') { const current = await client.workPlan(sessionId); if (!current.plan) output.write('当前没有可批准的计划。请先让 Isla 制定计划。\n'); else { await client.setWorkMode(sessionId, root, 'act', current.plan.revision); output.write(`已批准 Plan revision ${current.plan.revision}，进入 Act 模式。\n`); } lines.prompt(); return; }
    if (text === '/plan mode plan' || text === '/plan mode review') { const mode = text.endsWith('review') ? 'review' : 'plan'; await client.setWorkMode(sessionId, root, mode); output.write(`当前模式：${mode}\n`); lines.prompt(); return; }
    if(text==='/checkpoint'){writeJson('/checkpoint',await client.checkpoints(sessionId,root));lines.prompt();return;}
    if(text.startsWith('/checkpoint preview ')){const id=text.slice(20).trim();const preview=await client.checkpointOperation(sessionId,root,'preview',id) as WorkspaceCheckpointPreview;output.write(`${formatWorkspaceCheckpointPreview(preview)}\n`);lines.prompt();return;}
    if(text.startsWith('/checkpoint restore ')){const id=text.slice(20).trim();const preview=await client.checkpointOperation(sessionId,root,'preview',id) as WorkspaceCheckpointPreview;output.write(`${formatWorkspaceCheckpointPreview(preview)}\n恢复预览已显示。再次输入 /checkpoint restore-confirm <id> 执行破坏性恢复。\n`);lines.prompt();return;}
    if(text.startsWith('/checkpoint restore-confirm ')){const id=text.slice(28).trim();writeJson('/checkpoint restore',await client.checkpointOperation(sessionId,root,'restore',id,true));lines.prompt();return;}
    if (text === '/memory' || text.startsWith('/memory ')) { const parts = text.split(/\s+/u); const action = parts[1] ?? 'list'; if (action === 'disable' && parts[2]) { const value = await client.memory('show', parts[2]) as { revision?: number }; if (!Number.isInteger(value.revision)) throw new Error('MEMORY_NOT_FOUND'); writeJson('/memory', await client.disableMemory(parts[2], value.revision!)); } else { const value = await client.memory(action === 'show' ? 'show' : 'list', action === 'show' ? parts[2] : undefined); writeJson('/memory', value); } lines.prompt(); return; }
    if (text === '/model' || text.startsWith('/model ')) { output.write('模型由 Resident Host 启动配置决定，远程交互中不能切换。\n'); lines.prompt(); return; }
    busy = true; cancelRequested = false; controller = new AbortController();
    let delta = ''; let sawDelta = false;
    try {
      await client.promptStream(sessionId, text, root, event => {
        if (event.type === 'turn_start') { active = { sessionId: event.sessionId, turnId: event.turnId }; }
        else if (event.type === 'model_delta') { if (!sawDelta) output.write('Isla> '); sawDelta = true; delta += event.text; output.write(event.text); }
        else if (event.type === 'tool_start') output.write(`\n[工具] ${event.tool} 开始\n`);
        else if (event.type === 'tool_end') output.write(`[工具] ${event.tool} ${event.ok ? '完成' : '未完成'}\n`);
        else if (event.type === 'approval_requested') { interaction = { type: 'approval', id: event.approvalId }; output.write(`\n需要审批：${event.tool} · ${event.permission} · ${event.summary}\n输入 y 批准，其他内容拒绝：`); }
        else if (event.type === 'question_requested') { const questions = event.questions; if (questions.length) { interaction = { type: 'question', id: event.questionId, questionIds: questions.map(question => question.id) }; output.write(`\n${questions.map((question, index) => `${index + 1}. ${question.question}`).join('\n')}\n请按顺序回答；多题请用 | 分隔：`); } }
        else if (event.type === 'turn_completed') { if (!sawDelta) output.write(`Isla> ${event.text}`); else if (event.text !== delta) output.write(`\n[最终回答]\n${event.text}`); output.write('\n'); }
      }, controller.signal);
    } catch (error) { if (!(controller.signal.aborted || error instanceof Error && error.message === 'TURN_CANCELLED')) output.write(`Error: ${error instanceof Error ? error.message : '请求失败'}\n`); }
    finally { busy = false; active = undefined; interaction = undefined; controller = undefined; lines.prompt(); }
  })().catch(error => { output.write(`Error: ${error instanceof Error ? error.message : '请求失败'}\n`); lines.prompt(); }); });
  lines.on('close', () => { if (active) { if (cancelRequested) controller?.abort(); else void client.cancel(active.sessionId, active.turnId); } process.off('SIGINT', sigint); });
  lines.prompt();
  await new Promise<void>(resolve => lines.once('close', resolve));
}

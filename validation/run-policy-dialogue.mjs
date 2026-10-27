import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, rm } from 'node:fs/promises';

const root = 'D:/Private/Isla';
const sessionDir = `${root}/.validation-policy-${process.pid}`;
const executable = process.execPath;
await mkdir(sessionDir, { recursive: true });
const child = spawn(process.execPath, ['dist/entrypoints/cli.js', '--config', `${process.env.USERPROFILE}/.isla/config.json`, '--profile', 'bailian', '--protocol', 'ndjson'], {
  cwd: root, env: { ...process.env, ISLA_SESSION_DIR: sessionDir }, stdio: ['pipe', 'pipe', 'pipe'],
});
const lines = createInterface({ input: child.stdout }); let sent = false; let ended = false; let responseValid = false; let environmentOk = false; let startOk = false; let readOk = false; let statusOk = false; let sawApproval = false;
lines.on('line', line => {
  const event = JSON.parse(line);
  if (event.type === 'ready' && !sent) { sent = true; child.stdin.write(`${JSON.stringify({ type: 'prompt', id: 'policy-dialogue', text: `这是一个执行任务，不是咨询：先用 exec_environment 检查 node 是否可用；然后依次调用 exec_start 执行 executable=${executable}、argv=["--version"]，记录返回的 processId；再调用 exec_read 用 afterCursor=0 读取真实输出；最后调用 exec_status 核实进程已退出及 exitCode。严格以工具结果为准，最后只用一句话报告 node 版本、进程状态和退出码，不要重复步骤。` })}\n`); }
  if (event.type === 'approval_request') {
    sawApproval = true;
    child.stdin.write(`${JSON.stringify({ type: 'approval_response', id: `approval-response-${event.approvalId}`, approvalId: event.approvalId, approved: true })}\n`);
  }
  if (event.type === 'tool_end' && event.tool === 'exec_environment') environmentOk = event.ok === true;
  if (event.type === 'tool_end' && event.tool === 'exec_start') startOk = event.ok === true;
  if (event.type === 'tool_end' && event.tool === 'exec_read') readOk = event.ok === true;
  if (event.type === 'tool_end' && event.tool === 'exec_status') statusOk = event.ok === true;
  if (event.type === 'response_end' || event.type === 'error') {
    ended = event.type === 'response_end' && Boolean(event.text?.trim());
    responseValid = /v\d+\.\d+\.\d+/u.test(event.text ?? '') && /(exitCode\s*[=:：]?\s*0|退出码(?:为)?\s*0)/u.test(event.text ?? '') && /exited|已退出|正常退出/u.test(event.text ?? '');
    process.stdout.write(`${JSON.stringify({ type: event.type, code: event.code, response: event.text?.slice(0, 300), responseLength: event.text?.length ?? 0, responseValid, environmentOk, startOk, readOk, statusOk, sawApproval })}\n`);
    child.stdin.write(`${JSON.stringify({ type: 'exit', id: 'policy-exit' })}\n`);
  }
});
child.stderr.on('data', chunk => { for (const line of String(chunk).split(/\r?\n/u)) if (line.trim()) process.stderr.write(`${line.replace(/(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+)/giu, '<redacted>')}\n`); });
const exitCode = await new Promise(resolve => child.once('close', resolve));
await rm(sessionDir, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify({ type: 'process_closed', exitCode, ended, responseValid, environmentOk, startOk, readOk, statusOk, sawApproval })}\n`);
if (exitCode !== 0 || !ended || !responseValid || !environmentOk || !startOk || !readOk || !statusOk || !sawApproval) process.exitCode = 1;

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const root = 'D:/Private/Isla';
const sessionDir = `${root}/.validation-kernel-session-${process.pid}`;
const child = spawn(process.execPath, ['dist/entrypoints/cli.js', '--config', `${process.env.USERPROFILE}/.isla/config.json`, '--profile', 'bailian', '--protocol', 'ndjson'], {
  cwd: root,
  env: { ...process.env, ISLA_SESSION_DIR: sessionDir },
  stdio: ['pipe', 'pipe', 'pipe'],
});
const lines = createInterface({ input: child.stdout });
let sent = false;
let completed = false;
lines.on('line', line => {
  const event = JSON.parse(line);
  if (event.type === 'ready' && !sent) {
    sent = true;
    child.stdin.write(`${JSON.stringify({ type: 'prompt', id: 'kernel-dialogue', text: '用两三句话说明你能怎样帮助用户连续完成一个需要查资料、执行步骤并验证结果的任务；请说明遇到权限动作时会如何处理。' })}\n`);
  }
  if (event.type === 'response_end') {
    completed = Boolean(event.text?.trim());
    process.stdout.write(JSON.stringify({ type: event.type, outcome: event.outcome, responseLength: event.text?.length ?? 0, completed }) + '\n');
    child.stdin.write(`${JSON.stringify({ type: 'exit', id: 'kernel-exit' })}\n`);
  }
  if (event.type === 'error') {
    process.stdout.write(JSON.stringify({ type: 'error', code: event.code }) + '\n');
    child.stdin.write(`${JSON.stringify({ type: 'exit', id: 'kernel-exit' })}\n`);
  }
});
child.stderr.on('data', chunk => {
  const text = String(chunk);
  for (const line of text.split(/\r?\n/u)) if (line.trim()) process.stderr.write(`${line.replace(/(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+)/giu, '<redacted>')}\n`);
});
const exitCode = await new Promise(resolve => child.once('close', resolve));
process.stdout.write(JSON.stringify({ type: 'process_closed', exitCode, completed }) + '\n');
if (exitCode !== 0 || !completed) process.exitCode = 1;

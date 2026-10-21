import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const node = process.execPath;
const root = process.cwd();
const config = process.argv[2];
const profile = process.argv[3] ?? 'bailian';
const sessionDir = process.argv[4] ?? join(root, '.isla-local', 'evaluations', `live-${randomUUID()}`);
const logPath = join(sessionDir, 'dialogue.ndjson');
await mkdir(sessionDir, { recursive: true });
const child = spawn(node, ['dist/cli.js', '--config', config, '--profile', profile, '--protocol', 'ndjson'], { cwd: root, env: { ...process.env, ISLA_SESSION_DIR: sessionDir }, stdio: ['pipe', 'pipe', 'pipe'] });
const lines = [];
const rl = createInterface({ input: child.stdout });
const errors = [];
child.stderr.on('data', chunk => errors.push(String(chunk).replace(/(api[_-]?key|authorization|bearer)\s*[:=]\s*[^,\s}]+/gi, '$1:[redacted]')));
rl.on('line', line => {
  const safe = line.replace(/(api[_-]?key|authorization|bearer)\s*[:=]\s*[^,\s}]+/gi, '$1:[redacted]');
  lines.push(safe); process.stdout.write(`${safe}\n`);
  try {
    const event = JSON.parse(line);
    if (event.type === 'approval_request' && event.approvalId) {
      child.stdin.write(`${JSON.stringify({ type: 'approval_response', id: `${event.id}-eval-approval`, approvalId: event.approvalId, approved: true })}\n`);
    }
  } catch { /* protocol output is logged even when a line is not JSON */ }
});
const waitFor = (id, timeout = 180000) => new Promise((resolve, reject) => {
  const start = Date.now();
  const timer = setInterval(() => {
    const found = lines.slice().reverse().find(line => line.includes(`"id":"${id}"`) && /"type":"(response_end|error|response_cancelled)"/.test(line));
    if (found) { clearInterval(timer); resolve(JSON.parse(found)); }
    else if (Date.now() - start > timeout) { clearInterval(timer); reject(new Error(`timeout ${id}`)); }
  }, 100);
});
const prompts = [
  ['e01-fixed', '请检查当前项目的代理、联网能力和工具限制：区分当前代码事实、历史文档结论和未验证部分，不要修改文件。'],
  ['e02-narrow', '只回答当前项目 package.json 的版本号，并说明读取了哪个文件。不要读取其他文件。'],
  ['e10-missing-search', '请搜索网上公开资料并核实一个当前事实；如果当前 Profile 没有搜索能力，请明确说明缺少什么，不要伪造联网结果。'],
];
for (const [id, text] of prompts) { child.stdin.write(`${JSON.stringify({ type: 'prompt', id, text })}\n`); try { await waitFor(id); } catch (error) { process.stdout.write(`EVAL_ERROR ${id} ${error.message}\n`); } }
child.stdin.write(`${JSON.stringify({ type: 'exit', id: 'eval-exit' })}\n`);
await new Promise(resolve => child.once('close', resolve));
await writeFile(logPath, `${lines.join('\n')}\n`, 'utf8');
process.stdout.write(`LOG_PATH=${logPath}\n`);

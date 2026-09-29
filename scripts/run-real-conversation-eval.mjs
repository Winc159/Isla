import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const root = await mkdtemp(`${tmpdir()}\\isla-real-conversation-${randomUUID()}-`);
const source = JSON.parse(await readFile(`${process.env.USERPROFILE}\\.isla\\config.json`, 'utf8'));
const profile = { ...source.profiles.bailian, sessionDirectory: `${root}\\sessions`, workspace: root, runtime: { ...(source.profiles.bailian.runtime ?? {}), maxContextTokens: 32000 }, memory: { enabled: false, database: `${root}\\memory.sqlite` }, appearance: { logLevel: 'quiet' } };
const configPath = `${root}\\config.json`;
await writeFile(configPath, JSON.stringify({ version: 1, defaultProfile: 'eval', profiles: { eval: profile } }), 'utf8');
const child = spawn(process.execPath, [resolve('dist/cli.js'), '--config', configPath, '--profile', 'eval', '--protocol', 'ndjson'], { cwd: root, env: { ...process.env, ISLA_BROWSER_CONSOLE: '1' }, stdio: ['pipe', 'pipe', 'inherit'] });
const lines = createInterface({ input: child.stdout });
const events = [];
const redact = (value) => { if (Array.isArray(value)) return value.map(redact); if (!value || typeof value !== 'object') return value; return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /custom|password|secret|token|apiKey/i.test(key) ? '[REDACTED]' : redact(item)])); };
lines.on('line', line => { try { const event = JSON.parse(line); events.push(event); if (event.type === 'approval_request') child.stdin.write(`${JSON.stringify({ type: 'approval_response', id: `approve-${event.approvalId}`, approvalId: event.approvalId, approved: true })}\n`); if (event.type === 'question_request') { const answers = event.questions.map(question => question.id === 'credential' ? (event.id === 'real-takeover' ? { id: question.id, selected: ['other'] } : { id: question.id, selected: ['other'], custom: 'TestOnly-2026!' }) : question.id === 'credential_mode' ? { id: question.id, selected: ['user_control'] } : question.id === 'credential_control_done' ? { id: question.id, selected: ['enter'] } : { id: question.id, selected: ['stop'] }); events.push({ type: 'simulated_user_answer', id: event.id, questionId: event.questionId, answers: answers.map(answer => ({ id: answer.id, selected: answer.selected, ...(answer.custom ? { custom: '[REDACTED]' } : {}) })) }); child.stdin.write(`${JSON.stringify({ type: 'question_response', id: `answer-${event.questionId}`, questionId: event.questionId, answers })}\n`); } if (event.type === 'ready' || event.type === 'response_end' || event.type === 'error' || event.type === 'tool_start' || event.type === 'tool_end' || event.type === 'approval_request' || event.type === 'question_request' || event.type === 'bye') console.log(JSON.stringify(event)); } catch { /* ignore malformed output */ } });
const waitFor = async (predicate, timeoutMs = 120000) => { const start = Date.now(); while (Date.now() - start < timeoutMs) { const found = events.find(predicate); if (found) return found; await new Promise(resolveWait => setTimeout(resolveWait, 100)); } throw new Error('timeout'); };
await waitFor(event => event.type === 'ready');
const prompts = [
  ['real-other', '请真实使用 browser tools 直接打开 https://github.com/login，观察登录表单。对密码字段调用 browser_request_credential，让用户选择 other 并手工提供一次性测试密码；Runtime 填入后不要读取、复述或返回密码，不要点击登录提交。最后调用 browser_close，只报告稳定状态。'],
  ['real-takeover', '请真实使用 browser tools 打开 https://github.com/login，观察登录表单。然后调用 browser_request_credential，让用户选择 other，再选择 user_control。必须明确提示网址并等待用户完成网页操作后输入 enter；恢复后重新观察页面，不要点击登录提交，最后关闭浏览器并报告控制权状态。'],
];
for (const [id, text] of prompts) { const before = events.length; events.push({ type: 'user_prompt', id, text }); child.stdin.write(`${JSON.stringify({ type: 'prompt', id, text })}\n`); await waitFor(event => event.type === 'response_end' && event.id === id); const segment = events.slice(before); console.log(JSON.stringify({ evaluation: id, response: segment.find(event => event.type === 'response_end' && event.id === id), tools: segment.filter(event => event.type === 'tool_start' || event.type === 'tool_end'), errors: segment.filter(event => event.type === 'error') })); }
child.stdin.write(`${JSON.stringify({ type: 'exit', id: 'exit-1' })}\n`);
await waitFor(event => event.type === 'bye', 10000);
child.stdin.end();
if (child.exitCode === null) await new Promise(resolveClose => child.once('close', resolveClose));
const transcriptDir = resolve('docs/proposals/v0.4.7/real-conversation-transcripts');
await mkdir(transcriptDir, { recursive: true });
const transcriptPath = resolve(transcriptDir, `github-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await writeFile(transcriptPath, JSON.stringify({ generatedAt: new Date().toISOString(), model: source.profiles.bailian.model, note: 'Secrets and question custom values are redacted.', events: redact(events) }, null, 2), 'utf8');
const markdownPath = transcriptPath.replace(/\.json$/, '.md');
const markdown = [`# Isla 真实对话记录`, ``, `模型：${source.profiles.bailian.model}`, ``, `> 密码、Token 和自定义秘密已脱敏。评估脚本模拟的回答会明确标记。`, ``];
for (const event of redact(events)) {
  if (event.type === 'user_prompt') markdown.push(`## 用户 (${event.id})`, ``, event.text, ``);
  else if (event.type === 'tool_start') markdown.push(`- Isla 调用工具：\`${event.tool}\`${event.url ? `，URL：${event.url}` : ''}`);
  else if (event.type === 'tool_end') markdown.push(`  - 工具结果：${event.ok ? '成功' : `失败 (${event.code ?? 'UNKNOWN'})`}`);
  else if (event.type === 'question_request') for (const question of event.questions) markdown.push(``, `### Isla 询问`, ``, question.question, ``, `选项：${(question.options ?? []).map(option => option.label).join(' / ')}`, ``);
  else if (event.type === 'simulated_user_answer') markdown.push(`评估脚本模拟用户回答：${event.answers.map(answer => `${answer.id}=${answer.selected.join(',')}${answer.custom ? '，custom=[REDACTED]' : ''}`).join('；')}`, ``);
  else if (event.type === 'response_end') markdown.push(``, `## Isla 最终回答`, ``, event.text, ``);
}
await writeFile(markdownPath, markdown.join('\n'), 'utf8');
console.log(JSON.stringify({ transcript: transcriptPath, readableTranscript: markdownPath, eventCount: events.length }));
for (let attempt = 0; attempt < 5; attempt += 1) { try { await rm(root, { recursive: true, force: true }); break; } catch (error) { if (attempt === 4) throw error; await new Promise(resolveWait => setTimeout(resolveWait, 500)); } }

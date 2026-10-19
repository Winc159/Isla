import { spawn } from 'node:child_process';

const [operation, ...rest] = process.argv.slice(2);
const allowed = new Set(['whoami', 'ls', 'download', 'transfer']);
if (!allowed.has(operation)) {
  console.error('用法：node scripts/bdpan-runner.mjs <whoami|ls|download|transfer> ...');
  console.error('登录必须使用 bdpan-storage Skill 提供的 login.sh，不由此脚本代办。');
  process.exit(2);
}
const agentName = process.env.ISLA_BDPAN_AGENT_NAME;
const sessionInput = process.env.ISLA_BDPAN_SESSION_INPUT;
const sessionId = process.env.ISLA_BDPAN_SESSION_ID;
if (!agentName || !sessionInput || !sessionId) { console.error('缺少显式 ISLA_BDPAN_AGENT_NAME/SESSION_INPUT/SESSION_ID；脚本不会猜测上下文。'); process.exit(2); }
const configArgs = process.env.BDPAN_CONFIG_PATH ? ['--config-path', process.env.BDPAN_CONFIG_PATH] : [];
const child = spawn('bdpan', [...configArgs, operation, ...rest, '--json', '--agentname', agentName, '--session-input', sessionInput, '--session-id', sessionId], { shell: false, stdio: 'inherit' });
child.once('error', error => { console.error(`无法执行 bdpan：${error.message}`); process.exit(1); });
child.once('close', code => process.exit(code ?? 1));

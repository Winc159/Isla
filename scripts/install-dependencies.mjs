import { spawnSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const strict = args.has('--strict');
const installBrowser = !args.has('--no-browser');
const installResource = !args.has('--no-resource');
const failures = [];

function run(command, commandArgs, label) {
  process.stdout.write(`[deps] ${label}\n`);
  const result = spawnSync(command, commandArgs, { stdio: 'inherit', shell: false });
  if (result.error || result.status !== 0) {
    failures.push(label);
    process.stderr.write(`[deps] ${label} failed${result.error ? `: ${result.error.message}` : ''}\n`);
    return false;
  }
  return true;
}

function find(command) {
  const probe = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(probe, [command], { stdio: 'pipe', shell: false, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim().split(/\r?\n/u)[0] : undefined;
}

if (installBrowser) {
  const npm = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  run(npm, ['playwright', 'install', 'chromium'], 'Playwright Chromium');
}

if (installResource) {
  process.stdout.write('[deps] Resource 外部工具探测\n');
  const tools = [
    ['7zz', '7zz/7zzs 用于归档测试与解压'],
    ['7z', '7z 兼容命令，可作为 7zz fallback'],
    ['unrar', 'unrar 仅作为复杂 RAR fallback'],
  ];
  const found = new Map();
  for (const [command, description] of tools) {
    const path = find(command);
    if (path) { found.set(command, path); process.stdout.write(`[deps] found ${command}: ${path}\n`); }
    else process.stdout.write(`[deps] missing ${command}: ${description}\n`);
  }
  if (!found.has('7zz') && !found.has('7z')) failures.push('Resource archive tool (7zz/7z)');
  process.stdout.write('[deps] 尚未自动安装百度 runner：版本与命令契约需先锁定。\n');
}

if (failures.length > 0) {
  const message = `[deps] missing or failed: ${failures.join(', ')}\n`;
  if (strict) { process.stderr.write(message); process.exit(1); }
  process.stdout.write(message + '[deps] 非 strict 模式继续；请按平台安装缺失依赖后重试。\n');
}

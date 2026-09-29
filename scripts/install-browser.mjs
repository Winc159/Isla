import { spawnSync } from 'node:child_process';

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(command, ['playwright', 'install', 'chromium'], { stdio: 'inherit', shell: false });
if (result.error) {
  console.error(`无法执行 ${command}：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);

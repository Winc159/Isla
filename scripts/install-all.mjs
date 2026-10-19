import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const steps = [
  ['install-dependencies.mjs', args.filter(arg => arg !== '--force')],
  ['install-archive-tools.mjs', args.filter(arg => arg === '--force')],
  ...(process.platform === 'win32' ? [['install-bdpan.mjs', args.filter(arg => ['--force', '--yes'].includes(arg))]] : []),
];
for (const [script, scriptArgs] of steps) {
  const code = await run(join(root, script), scriptArgs);
  if (code !== 0) process.exit(code);
}
function run(script, args) { return new Promise(resolve => { const child = spawn(process.execPath, [script, ...args], { cwd: dirname(root), stdio: 'inherit', shell: false }); child.once('error', error => { console.error(`[install] ${error.message}`); resolve(1); }); child.once('close', code => resolve(code ?? 1)); }); }

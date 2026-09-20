import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const commands = [
  ['typecheck', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--noEmit']],
  ['tests', ['node_modules/vitest/vitest.mjs', 'run', '--pool=forks']],
  ['build', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json']],
];

for (const [label, args] of commands) {
  process.stdout.write(`\n[verify] ${label}\n`);
  const code = await new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' });
    child.on('exit', (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0)));
  });
  if (code !== 0) { process.stderr.write(`[verify] ${label} failed\n`); process.exit(code); }
}
process.stdout.write('\n[verify] all checks passed\n');

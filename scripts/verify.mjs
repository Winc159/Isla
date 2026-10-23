import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const commands = [
  ['clean', ['scripts/clean.mjs']],
  ['typecheck', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--noEmit']],
  ['build-runtime', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json']],
  ['mark-entrypoints', ['scripts/mark-entrypoints-executable.mjs']],
  ['tests', ['node_modules/vitest/vitest.mjs', 'run', '--pool=forks', '--exclude', 'tests/pty/**']],
  ['build-resource-ui', ['node_modules/vite/bin/vite.js', 'build', '--config', 'resource-ui/vite.config.ts']],
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

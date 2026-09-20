import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const child = spawn(process.execPath, [vitest, 'run', 'tests/smoke/mcp-interoperability.test.ts', '--pool=forks'], {
  stdio: 'inherit',
  env: { ...process.env, ISLA_RUN_MCP_EVAL: '1' },
});
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });

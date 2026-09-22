import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.env.ISLA_MCP_SERVER_COMMAND) {
  process.stdout.write('[mcp-eval] skipped: set ISLA_MCP_SERVER_COMMAND and optional ISLA_MCP_SERVER_ARGS\n');
  process.exit(0);
}
const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const child = spawn(process.execPath, [vitest, 'run', 'tests/smoke/mcp-interoperability.test.ts', '--pool=forks'], {
  stdio: 'inherit',
  env: { ...process.env, ISLA_RUN_MCP_EVAL: '1' },
});
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });

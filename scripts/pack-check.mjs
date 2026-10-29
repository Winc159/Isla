import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { validatePackageFiles } from './package-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const result = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 10 * 1024 * 1024 });
if (result.error || result.status !== 0) {
  process.stderr.write(`pack:check failed: ${result.error?.message ?? result.stderr ?? 'npm pack failed'}\n`);
  process.exit(1);
}

let pack;
try { pack = JSON.parse(result.stdout); }
catch { process.stderr.write('pack:check failed: npm pack output was not valid JSON\n'); process.exit(1); }
const files = pack[0]?.files?.map(item => item.path.replaceAll('\\', '/')) ?? [];
const check = validatePackageFiles(files);
for (const file of files) process.stdout.write(`${file}\n`);
if (!check.passed) {
  process.stderr.write(`pack:check failed: ${JSON.stringify(check)}\n`);
  process.exit(1);
}
if (!Array.isArray(packageJson.files) || packageJson.files.join('|') !== 'dist|README.md|LICENSE') {
  process.stderr.write('pack:check failed: package files allowlist changed; review explicitly\n');
  process.exit(1);
}
process.stdout.write(`\npack:check passed (${files.length} files)\n`);

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMarkdownReport, loadFixtures, summarizeTestOutput, validateFixtureSelection } from './evaluation-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesDirectory = resolve(root, 'evaluation/fixtures');
const outputDirectory = resolve(root, '.isla-local/evaluations');

function parseArgs(args) {
  const parsed = { ids: [], all: false, list: false };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--all') parsed.all = true;
    else if (args[index] === '--list') parsed.list = true;
    else if (args[index] === '--fixture' && args[index + 1]) parsed.ids.push(args[++index]);
    else throw new Error('EVALUATION_ARGUMENT_INVALID');
  }
  if (parsed.all && parsed.ids.length) throw new Error('EVALUATION_SELECTION_CONFLICT');
  return parsed;
}

async function runFixture(fixture, rawDirectory) {
  const startedAt = Date.now();
  const outputFile = resolve(rawDirectory, `${fixture.id.replaceAll('.', '_')}.log`);
  const command = [
    'node_modules/vitest/vitest.mjs', 'run', '--pool=forks', '--reporter=default',
    '--testTimeout=30000', '--hookTimeout=30000', '--testNamePattern', fixture.contractTests.namePattern,
    ...fixture.contractTests.files,
  ];
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let interrupted = false;
  let timer;
  const childEnv = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP'].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
  childEnv.NO_COLOR = '1';
  childEnv.FORCE_COLOR = '0';
  const exitCode = await new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, command, { cwd: root, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    const stop = () => { interrupted = true; child.kill('SIGTERM'); };
    process.once('SIGINT', stop);
    timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, fixture.timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { process.removeListener('SIGINT', stop); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      process.removeListener('SIGINT', stop);
      resolveExit(code ?? 1);
    });
  });
  const combined = `${stdout}\n${stderr}`;
  await writeFile(outputFile, combined, { mode: 0o600 });
  const counts = summarizeTestOutput(combined);
  const status = timedOut ? 'timeout' : interrupted ? 'cancelled' : exitCode === 0 && counts.passed > 0 && counts.failed === 0 ? 'passed' : 'failed';
  const failureCode = status === 'passed' ? null : timedOut ? 'FIXTURE_TIMEOUT' : interrupted ? 'RUN_CANCELLED' : exitCode !== 0 ? 'TEST_PROCESS_FAILED' : counts.failed > 0 ? 'FIXTURE_ASSERTION_FAILED' : 'FIXTURE_TEST_NOT_EXECUTED';
  return {
    id: fixture.id,
    capability: fixture.capability,
    status,
    failureCode,
    durationMs: Date.now() - startedAt,
    safetyChecks: fixture.gateClass === 'security' ? fixture.expectedFacts.length : 0,
    testCounts: counts,
    exitCode,
    rawArtifact: outputFile,
    summary: `contract tests: ${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped`,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixtures = await loadFixtures(fixturesDirectory, root);
  if (args.list) {
    for (const fixture of fixtures) process.stdout.write(`${fixture.id}\t${fixture.capability}\n`);
    return;
  }
  const selected = validateFixtureSelection(fixtures, args.all ? fixtures.map(item => item.id) : args.ids);
  const runId = `${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}-${process.pid}`;
  const rawDirectory = resolve(outputDirectory, runId);
  await mkdir(rawDirectory, { recursive: true, mode: 0o700 });
  const results = [];
  for (const fixture of selected) {
    process.stdout.write(`[evaluate] ${fixture.id}\n`);
    results.push(await runFixture(fixture, rawDirectory));
  }
  const revision = await new Promise(resolveRevision => {
    const child = spawn('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
    child.on('exit', code => resolveRevision(code === 0 ? output.trim() : 'unknown'));
  });
  const gitStatus = await new Promise(resolveStatus => {
    const child = spawn('git', ['status', '--porcelain'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
    child.on('exit', () => resolveStatus(output.trim().length > 0));
  });
  const report = {
    schemaVersion: 1,
    runId,
    revision: { commit: revision, dirty: gitStatus },
    environment: { node: process.versions.node, platform: process.platform, arch: process.arch },
    gate: { status: results.every(item => item.status === 'passed') ? 'passed' : 'failed' },
    fixtures: results.map(({ rawArtifact, ...item }) => item),
    rawArtifactDirectory: '.isla-local/evaluations/<runId>',
    realModelAssessment: 'not_run',
  };
  const safeReport = JSON.stringify(report, null, 2);
  await writeFile(resolve(rawDirectory, 'report.json'), safeReport, { mode: 0o600 });
  await writeFile(resolve(rawDirectory, 'report.md'), buildMarkdownReport({ ...report, fixtures: report.fixtures.map(item => ({ ...item, rawArtifact: undefined })) }), { mode: 0o600 });
  process.stdout.write(`\n[evaluate] offline gate ${report.gate.status}; report: .isla-local/evaluations/${runId}/report.md\n`);
  if (report.gate.status !== 'passed') process.exitCode = 1;
}

main().catch(error => {
  process.stderr.write(`[evaluate] ${error instanceof Error ? error.message : 'EVALUATION_FAILED'}\n`);
  process.exitCode = 1;
});

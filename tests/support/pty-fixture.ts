import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { OpenAI_fixtureServer } from './openai-fixture-server.js';
import { PtyDriver } from './pty-driver.js';

export async function createPtyFixture(options: { readonly withMcp?: boolean } = {}): Promise<{ readonly root: string; readonly workspace: string; readonly server: OpenAI_fixtureServer; readonly driver: PtyDriver; readonly dispose: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'isla-pty-'));
  const workspace = join(root, 'workspace');
  const sessions = join(root, 'sessions');
  const memory = join(root, 'memory');
  await mkdir(join(workspace, '.isla', 'skills', 'fixture-review'), { recursive: true });
  await mkdir(sessions, { recursive: true });
  await mkdir(memory, { recursive: true });
  await writeFile(join(workspace, '.isla', 'skills', 'fixture-review', 'SKILL.md'), '---\nname: fixture-review\ndescription: Review the fixture\nuser-invocable: true\nmodel-invocable: true\n---\nReturn the fixed fixture result.\n', 'utf8');
  const server = new OpenAI_fixtureServer();
  await server.start();
  const configPath = join(root, 'config.json');
  const profile = {
    provider: 'bailian', model: 'qwen-plus', apiKey: 'pty-test-key', baseURL: `http://127.0.0.1:${server.port}/v1`, workspace, sessionDirectory: sessions,
    runtime: { timeoutMs: 5_000, modelRetries: 0 }, memory: { enabled: false, database: join(memory, 'memory.sqlite') }, appearance: { personality: 'minimal', logLevel: 'quiet' }, tools: { webFetch: { enabled: false } },
    ...(options.withMcp ? { mcp: { servers: [{ id: 'fixture', transport: 'stdio', command: process.execPath, args: [resolve(process.cwd(), 'tests/fixtures/mcp-stdio-server.mjs')], required: false, startupTimeoutMs: 10_000, callTimeoutMs: 1_000, env: {} }] } } : {}),
  };
  await writeFile(configPath, JSON.stringify({ version: 1, defaultProfile: 'pty', profiles: { pty: profile } }), 'utf8');
  const node = process.execPath;
  const entry = resolve(process.cwd(), 'dist', 'cli.js');
  const driver = new PtyDriver(node, [entry, '--config', configPath, '--profile', 'pty'], { cwd: process.cwd(), env: { ...process.env as Record<string, string>, USERPROFILE: root, HOME: root, HOMEDRIVE: '', HOMEPATH: '', ISLA_MEMORY_ENABLED: '0' } });
  await driver.waitForText('you>');
  return { root, workspace, server, driver, dispose: async () => { await driver.dispose(); await server.close(); await rm(root, { recursive: true, force: true }); } };
}

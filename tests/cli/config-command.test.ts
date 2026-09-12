import { describe, expect, it } from 'vitest';
import { PassThrough, Writable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigStore } from '../../src/config-store.js';
import { configCommand } from '../../src/cli/config-command.js';
import type { CliCommandContext } from '../../src/cli/command.js';

function context(store: ConfigStore, line: string, output: (text: string) => void, openConfig?: (path: string) => Promise<void>): CliCommandContext {
  return {
    input: new PassThrough(), output: new Writable({ write(chunk, _encoding, callback) { output(chunk.toString()); callback(); } }),
    providerId: 'deepseek', model: 'deepseek-chat', systemPrompt: undefined,
    sessionStore: { list: async () => [], loadLatest: async () => undefined, create: async () => { throw new Error('unused'); }, save: async () => { throw new Error('unused'); } },
    currentSession: { version: 1, id: 's', createdAt: 'now', updatedAt: 'now', provider: 'deepseek', model: 'deepseek-chat', messages: [] },
    availableCommands: [], configStore: store, configPath: store.path, profileName: 'main', ...(openConfig ? { openConfig } : {}), commandLine: line,
  };
}

describe('/config', () => {
  it('shows a safe summary without exposing the API key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'isla-config-command-'));
    try {
      const store = new ConfigStore(join(root, 'config.json'));
      await store.save({ version: 1, defaultProfile: 'main', profiles: { main: { provider: 'deepseek', model: 'deepseek-chat', apiKey: 'test-only-secret' } } });
      let output = '';
      await configCommand.execute(context(store, '/config show', text => { output += text; }));
      expect(output).toContain('当前 Profile：main');
      expect(output).toContain('API Key：已配置');
      expect(output).not.toContain('test-only-secret');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('uses an injected opener for /config open and reports next-start semantics', async () => {
    const root = await mkdtemp(join(tmpdir(), 'isla-config-command-'));
    try {
      const store = new ConfigStore(join(root, 'config.json'));
      let opened = '';
      let output = '';
      await configCommand.execute(context(store, '/config open', text => { output += text; }, async path => { opened = path; }));
      expect(opened).toBe(store.path);
      expect(output).toContain('下次启动生效');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('does not run setup in a non-interactive context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'isla-config-command-'));
    try {
      const store = new ConfigStore(join(root, 'config.json'));
      let output = '';
      await configCommand.execute(context(store, '/config setup', text => { output += text; }));
      expect(output).toContain('需要交互式终端');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

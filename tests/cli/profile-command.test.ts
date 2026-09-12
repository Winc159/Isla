import { describe, expect, it } from 'vitest';
import { PassThrough, Writable } from 'node:stream';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigStore } from '../../src/config-store.js';
import { profileCommand } from '../../src/cli/profile-command.js';
import type { CliCommandContext } from '../../src/cli/command.js';

function context(store: ConfigStore, line: string, output: (text: string) => void): CliCommandContext {
  return {
    input: new PassThrough(), output: new Writable({ write(chunk, _encoding, callback) { output(chunk.toString()); callback(); } }),
    providerId: 'deepseek', model: 'deepseek-chat', systemPrompt: undefined,
    sessionStore: { list: async () => [], loadLatest: async () => undefined, create: async () => { throw new Error('unused'); }, save: async () => { throw new Error('unused'); } },
    currentSession: { version: 1, id: 's', createdAt: 'now', updatedAt: 'now', provider: 'deepseek', model: 'deepseek-chat', messages: [] },
    availableCommands: [], configStore: store, configPath: store.path, profileName: 'main', commandLine: line,
  };
}

describe('/profile', () => {
  it('lists profiles in stable order without secrets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'isla-profile-command-'));
    try {
      const store = new ConfigStore(join(root, 'config.json'));
      await store.save({ version: 1, defaultProfile: 'zeta', profiles: { zeta: { provider: 'deepseek', model: 'z', apiKey: 'secret-z' }, alpha: { provider: 'deepseek', model: 'a', apiKey: 'secret-a' } } });
      let output = '';
      await profileCommand.execute(context(store, '/profile list', text => { output += text; }));
      expect(output.indexOf('alpha')).toBeLessThan(output.indexOf('zeta'));
      expect(output).toContain('zeta · deepseek · z · 默认');
      expect(output).not.toContain('secret-');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('changes only the default profile and leaves both profiles intact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'isla-profile-command-'));
    try {
      const store = new ConfigStore(join(root, 'config.json'));
      await store.save({ version: 1, defaultProfile: 'main', profiles: { main: { provider: 'deepseek', model: 'm', apiKey: 'secret-m' }, local: { provider: 'local', model: 'l', baseURL: 'http://localhost:11434/v1' } } });
      let output = '';
      await profileCommand.execute(context(store, '/profile use local', text => { output += text; }));
      const source = await readFile(store.path, 'utf8');
      expect(JSON.parse(source)).toMatchObject({ defaultProfile: 'local', profiles: { main: { apiKey: 'secret-m' }, local: { model: 'l' } } });
      expect(output).toContain('下次启动生效');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('does not change the config for an unknown profile or malformed command', async () => {
    const root = await mkdtemp(join(tmpdir(), 'isla-profile-command-'));
    try {
      const store = new ConfigStore(join(root, 'config.json'));
      const saved = await store.save({ version: 1, defaultProfile: 'main', profiles: { main: { provider: 'deepseek', model: 'm', apiKey: 'secret-m' } } });
      let output = '';
      await profileCommand.execute(context(store, '/profile use missing', text => { output += text; }));
      await profileCommand.execute(context(store, '/profile use', text => { output += text; }));
      expect((await store.load()).revision).toBe(saved.revision);
      expect(output).toContain('未找到 Profile');
      expect(output).toContain('用法');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

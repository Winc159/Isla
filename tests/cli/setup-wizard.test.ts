import { describe, expect, it } from 'vitest';
import { buildConfigWithWizard, type SetupPrompter } from '../../src/cli/setup-wizard.js';

function prompter(overrides: Partial<SetupPrompter> = {}): SetupPrompter {
  return {
    ask: async (_question, defaultValue) => defaultValue ?? 'value',
    secret: async () => 'test-only-key',
    confirm: async () => true,
    choose: async (_question, options, defaultValue) => defaultValue ?? options[0],
    ...overrides,
  };
}

describe('setup wizard', () => {
  it('builds a DeepSeek profile with defaults and does not perform network calls', async () => {
    const config = await buildConfigWithWizard(prompter({ ask: async (question, defaultValue) => question === 'Profile name' ? 'main' : (defaultValue ?? 'deepseek-chat') }), undefined);
    expect(config).toMatchObject({ version: 1, defaultProfile: 'main', profiles: { main: { provider: 'deepseek', model: 'deepseek-chat', apiKey: 'test-only-key', memory: { enabled: true }, appearance: { personality: 'default', logLevel: 'normal' } } } });
  });

  it('builds a local profile without a key and preserves existing profiles', async () => {
    const config = await buildConfigWithWizard(prompter({
      ask: async (question, defaultValue) => question === 'Profile name' ? 'local' : (question === 'Model' ? 'llama' : (defaultValue ?? 'http://localhost:11434/v1')),
      choose: async (question) => question.startsWith('Provider') ? 'local' : question.startsWith('Personality') ? 'minimal' : 'debug',
      secret: async () => '',
    }), { version: 1, defaultProfile: 'main', profiles: { main: { provider: 'deepseek', model: 'm', apiKey: 'old-key' } } });
    expect(config).toMatchObject({ defaultProfile: 'local', profiles: { main: { apiKey: 'old-key' }, local: { provider: 'local', model: 'llama', baseURL: 'http://localhost:11434/v1' } } });
  });

  it('returns undefined when the user cancels a required step', async () => {
    await expect(buildConfigWithWizard(prompter({ secret: async () => undefined }))).resolves.toBeUndefined();
  });
});

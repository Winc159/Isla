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
  it('builds a Bailian profile with an explicit base URL', async () => {
    const config = await buildConfigWithWizard(prompter({
      ask: async (question, defaultValue) => question === 'Profile name' ? 'bailian' : question.startsWith('Bailian base URL') ? 'https://workspace.example/compatible-mode/v1' : (defaultValue ?? 'qwen-plus'),
      choose: async (question) => question.startsWith('Provider') ? 'bailian' : 'default',
    }), undefined);
    expect(config).toMatchObject({ profiles: { bailian: { provider: 'bailian', model: 'qwen-plus', baseURL: 'https://workspace.example/compatible-mode/v1', apiKey: 'test-only-key' } } });
  });

  it('builds a DeepSeek profile with defaults and does not perform network calls', async () => {
    const config = await buildConfigWithWizard(prompter({ ask: async (question, defaultValue) => question === 'Profile name' ? 'main' : (defaultValue ?? 'deepseek-chat'), choose: async (question, options, defaultValue) => question.startsWith('Provider') ? 'deepseek' : defaultValue ?? options[0] }), undefined);
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

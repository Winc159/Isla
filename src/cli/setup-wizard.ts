import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';
import type { InteractiveInput } from './command.js';
import { ConfigStore } from '../config-store.js';
import type { IslaConfigFileV1, StartupProfileV1 } from '../config.js';

export interface SetupPrompter {
  readonly ask: (question: string, defaultValue?: string) => Promise<string | undefined>;
  readonly secret: (question: string) => Promise<string | undefined>;
  readonly confirm: (question: string, defaultValue?: boolean) => Promise<boolean | undefined>;
  readonly choose: (question: string, options: readonly string[], defaultValue?: string) => Promise<string | undefined>;
}

export async function buildConfigWithWizard(prompter: SetupPrompter, existing?: IslaConfigFileV1): Promise<IslaConfigFileV1 | undefined> {
  const name = await prompter.ask('Profile name', 'deepseek-main');
  if (!name?.trim()) return undefined;
  const provider = await prompter.choose('Provider (deepseek/openai/local)', ['deepseek', 'openai', 'local'], 'deepseek') as 'deepseek' | 'openai' | 'local' | undefined;
  if (!provider) return undefined;
  const model = await prompter.ask('Model', provider === 'deepseek' ? 'deepseek-chat' : undefined);
  if (!model?.trim()) return undefined;
  let profile: StartupProfileV1;
  if (provider === 'local') {
    const baseURL = await prompter.ask('Local base URL', 'http://localhost:11434/v1');
    if (!baseURL?.trim()) return undefined;
    const apiKey = await prompter.secret('Local API key (optional, press Enter to skip)');
    profile = { provider, model: model.trim(), baseURL: baseURL.trim(), ...(apiKey ? { apiKey } : {}) };
  } else {
    const apiKey = await prompter.secret(`${provider} API key`);
    if (!apiKey?.trim()) return undefined;
    profile = { provider, model: model.trim(), apiKey };
  }
  const memory = await prompter.confirm('Enable memory', true);
  if (memory === undefined) return undefined;
  const personality = await prompter.choose('Personality', ['default', 'minimal'], 'default');
  if (!personality) return undefined;
  const logLevel = await prompter.choose('Log level', ['quiet', 'normal', 'debug'], 'normal');
  if (!logLevel) return undefined;
  const result: IslaConfigFileV1 = {
    version: 1,
    defaultProfile: name.trim(),
    profiles: {
      ...(existing?.profiles ?? {}),
      [name.trim()]: { ...profile, memory: { enabled: memory }, appearance: { personality: personality as 'default' | 'minimal', logLevel: logLevel as 'quiet' | 'normal' | 'debug' } },
    },
  };
  return result;
}

export async function runSetupWizard(input: Readable, output: Writable, store: ConfigStore, interactiveInput: InteractiveInput): Promise<boolean> {
  const prompter = createTerminalPrompter(input, output, interactiveInput);
  const current = await store.load();
  const existing = current.status === 'ready' || current.status === 'empty' ? current.config : undefined;
  output.write('Isla 首次设置（API Key 将保存在本机 config.json 中，请注意本地明文凭据风险）\n');
  const config = await buildConfigWithWizard(prompter, existing);
  if (!config) { output.write('已取消设置，未写入配置。\n'); return false; }
  const profile = config.profiles[config.defaultProfile ?? ''];
  output.write(`\n配置摘要：profile=${config.defaultProfile} provider=${profile?.provider} model=${profile?.model} apiKey=${'apiKey' in (profile ?? {}) && profile?.apiKey ? '已配置' : '未配置'}\n`);
  const confirmed = await prompter.confirm('保存配置并启动', true);
  if (!confirmed) { output.write('已取消保存，未写入配置。\n'); return false; }
  await store.save(config, current.status === 'ready' || current.status === 'empty' ? current.revision : undefined);
  output.write(`配置已保存：${store.path}\n`);
  return true;
}

function createTerminalPrompter(input: Readable, output: Writable, interactive: InteractiveInput): SetupPrompter {
  const ask = async (question: string, defaultValue?: string) => {
    const answer = await askLine(input, output, `${question}${defaultValue ? ` [${defaultValue}]` : ''}: `);
    return answer === undefined ? undefined : (answer.trim() || defaultValue);
  };
  return {
    ask,
    secret: question => readSecret(interactive, output, `${question}: `),
    confirm: async (question, defaultValue = false) => {
      const answer = await askLine(input, output, `${question} [${defaultValue ? 'Y/n' : 'y/N'}]: `);
      if (answer === undefined) return undefined;
      if (!answer.trim()) return defaultValue;
      if (/^(y|yes)$/i.test(answer.trim())) return true;
      if (/^(n|no)$/i.test(answer.trim())) return false;
      output.write('请输入 y 或 n。\n');
      return createTerminalPrompter(input, output, interactive).confirm(question, defaultValue);
    },
    choose: async (question, options, defaultValue) => {
      output.write(`${question}: ${options.map((option, index) => `${index + 1}) ${option}`).join('  ')}\n`);
      const answer = await askLine(input, output, `选择${defaultValue ? ` [${defaultValue}]` : ''}: `);
      if (answer === undefined) return undefined;
      if (!answer.trim() && defaultValue) return defaultValue;
      const index = Number(answer.trim()) - 1;
      return options[index] ?? options.find(option => option === answer.trim());
    },
  };
}

async function askLine(input: Readable, output: Writable, prompt: string): Promise<string | undefined> {
  const rl = createInterface({ input, output });
  try { return await rl.question(prompt); } catch { return undefined; } finally { rl.close(); }
}

function readSecret(input: InteractiveInput, output: Writable, prompt: string): Promise<string | undefined> {
  output.write(prompt);
  input.setRawMode(true);
  input.resume();
  return new Promise(resolve => {
    let value = '';
    const finish = (result: string | undefined) => { input.removeListener('data', onData); input.setRawMode(false); input.pause(); output.write('\n'); resolve(result); };
    const onData = (chunk: Buffer | string) => {
      const text = chunk.toString();
      if (text === '\u0003' || text === '\u001b') return finish(undefined);
      if (text === '\r' || text === '\n') return finish(value);
      if (text === '\u007f' || text === '\b') { value = value.slice(0, -1); return; }
      if (!text.includes('\u0000')) value += text;
    };
    input.on('data', onData);
  });
}

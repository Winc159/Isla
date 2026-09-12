import { describe, expect, it } from 'vitest';
import { parseConfigFile, profileToAppConfig, resolveProfile } from '../src/config.js';

const deepseek = (extra: Record<string, unknown> = {}) => JSON.stringify({ version: 1, profiles: { main: { provider: 'deepseek', model: 'deepseek-chat', apiKey: 'test-only-key', ...extra } } });

describe('config file v1', () => {
  it('parses a minimal profile and applies app defaults', () => {
    const file = parseConfigFile(deepseek());
    expect(resolveProfile(file)).toEqual({ name: 'main', profile: expect.objectContaining({ provider: 'deepseek', model: 'deepseek-chat' }) });
    expect(profileToAppConfig(file.profiles.main)).toMatchObject({ provider: 'deepseek', model: 'deepseek-chat', apiKey: 'test-only-key', timeoutMs: 600000, modelRetries: 0, maxContextTurns: 20, maxContextChars: 60000, contextRetainTurns: 6, memoryEnabled: true, personality: 'default', logLevel: 'normal' });
  });

  it('supports local profiles without an API key', () => {
    const file = parseConfigFile(JSON.stringify({ version: 1, profiles: { local: { provider: 'local', model: 'llama', baseURL: 'http://localhost:11434/v1' } } }));
    expect(profileToAppConfig(file.profiles.local)).toMatchObject({ provider: 'local', baseURL: 'http://localhost:11434/v1' });
  });

  it('projects runtime, memory and appearance settings without mutating source', () => {
    const source = { version: 1, profiles: { main: { provider: 'deepseek', model: 'm', apiKey: 'test-only-key', runtime: { timeoutMs: 1000, modelRetries: 1, maxContextTurns: 4, maxContextChars: 5000, contextRetainTurns: 2 }, memory: { enabled: false, database: 'memory.sqlite' }, appearance: { personality: 'minimal', logLevel: 'debug' } } } };
    const file = parseConfigFile(JSON.stringify(source));
    const config = profileToAppConfig(file.profiles.main);
    expect(config).toMatchObject({ timeoutMs: 1000, modelRetries: 1, maxContextTurns: 4, maxContextChars: 5000, contextRetainTurns: 2, memoryEnabled: false, memoryDatabase: 'memory.sqlite', personality: 'minimal', logLevel: 'debug', debug: true, systemPrompt: expect.stringContaining('简洁') });
    source.profiles.main.model = 'changed';
    expect(file.profiles.main.model).toBe('m');
  });

  it('requires an explicit profile when several exist', () => {
    const file = parseConfigFile(JSON.stringify({ version: 1, profiles: { a: { provider: 'deepseek', model: 'm', apiKey: 'a' }, b: { provider: 'deepseek', model: 'm', apiKey: 'b' } } }));
    expect(() => resolveProfile(file)).toThrow('explicit profile');
    expect(resolveProfile(file, 'b').profile).toMatchObject({ apiKey: 'b' });
  });

  it('rejects malformed schemas without exposing secrets', () => {
    const secret = 'test-only-secret-key';
    expect(() => parseConfigFile('{')).toThrow('Invalid Isla config JSON');
    expect(() => parseConfigFile(JSON.stringify({ version: 2, profiles: {} }))).toThrow('version');
    expect(() => parseConfigFile(JSON.stringify({ version: 1, profiles: { main: { provider: 'deepseek', model: 'm', apiKey: secret, runtime: { modelRetries: 2 } } } }))).toThrow('modelRetries');
    try { parseConfigFile(JSON.stringify({ version: 1, profiles: { main: { provider: 'deepseek', model: 'm', apiKey: secret } } })); } catch (error) { expect(String(error)).not.toContain(secret); }
  });

  it('rejects invalid URLs, enums and prototype-sensitive profile names', () => {
    expect(() => parseConfigFile(JSON.stringify({ version: 1, profiles: { local: { provider: 'local', model: 'm', baseURL: 'bad' } } }))).toThrow('baseURL');
    expect(() => parseConfigFile(JSON.stringify({ version: 1, profiles: { main: { provider: 'deepseek', model: 'm', apiKey: 'k', appearance: { logLevel: 'trace' } } } }))).toThrow('logLevel');
    expect(() => parseConfigFile(JSON.stringify({ version: 1, profiles: { constructor: { provider: 'deepseek', model: 'm', apiKey: 'k' } } }))).toThrow('profile name');
  });

  it('reports unknown fields through an injected warning callback', () => {
    const warnings: string[] = [];
    parseConfigFile(JSON.stringify({ version: 1, extra: true, profiles: { main: { provider: 'deepseek', model: 'm', apiKey: 'k', extra: true } } }), { onWarning: message => warnings.push(message) });
    expect(warnings).toEqual(['Ignored unknown Isla config field: config.extra', 'Ignored unknown Isla config field: profile main.extra']);
  });

  it('validates default profile references', () => {
    expect(() => parseConfigFile(JSON.stringify({ version: 1, defaultProfile: 'missing', profiles: { main: { provider: 'deepseek', model: 'm', apiKey: 'k' } } }))).toThrow('defaultProfile');
    const file = parseConfigFile(JSON.stringify({ version: 1, defaultProfile: 'main', profiles: { main: { provider: 'deepseek', model: 'm', apiKey: 'k' } } }));
    expect(resolveProfile(file).name).toBe('main');
  });
});

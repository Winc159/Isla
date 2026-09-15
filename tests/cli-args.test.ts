import { describe, expect, it } from 'vitest';
import { parseCliStartupArgs } from '../src/cli-args.js';

describe('CLI startup arguments', () => {
  it('accepts the non-interactive model catalog flag', () => expect(parseCliStartupArgs(['--models'])).toMatchObject({ models: true }));
  it('parses profile, config, env and protocol options', () => {
    expect(parseCliStartupArgs(['--profile', 'main', '--config', 'config.json', '--protocol', 'ndjson'])).toEqual({ profileName: 'main', configPath: 'config.json', useEnv: false, protocol: 'ndjson' });
    expect(parseCliStartupArgs(['--env'])).toEqual({ useEnv: true });
  });

  it('rejects missing values, unknown options and source conflicts', () => {
    expect(() => parseCliStartupArgs(['--profile'])).toThrow('requires a value');
    expect(() => parseCliStartupArgs(['--unknown'])).toThrow('Unknown argument');
    expect(() => parseCliStartupArgs(['--env', '--profile', 'main'])).toThrow('cannot be combined');
  });

  it('does not accept API keys as arguments', () => {
    expect(() => parseCliStartupArgs(['--api-key', 'test-only-key'])).toThrow('Unknown argument');
  });

  it('parses workspace without changing the config source', () => {
    expect(parseCliStartupArgs(['--workspace', 'project', '--profile', 'main'])).toMatchObject({ workspacePath: 'project', profileName: 'main', useEnv: false });
  });
});

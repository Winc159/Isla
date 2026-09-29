import { describe, expect, it } from 'vitest';
import { BrowserRuntime } from '../src/browser/runtime.js';
import type { BrowserAdapter } from '../src/browser/types.js';

describe('BrowserRuntime', () => {
  it('owns sessions and closes all handles', async () => {
    const closed: string[] = [];
    const adapter: BrowserAdapter = { launch: async options => ({ id: options.userDataDirectory.split('/').at(-1)!, snapshot: async () => ({ id: 'one', status: 'ready' }), close: async () => { closed.push('one'); } }) };
    const runtime = new BrowserRuntime({ adapter, userDataRoot: 'tmp', maxSessions: 1 });
    await expect(runtime.open('one')).resolves.toMatchObject({ id: 'one', status: 'ready' });
    await expect(runtime.open('two')).rejects.toThrow('limit');
    await runtime.closeAll();
    expect(closed).toEqual(['one']);
  });

  it('pauses agent actions during user takeover', async () => {
    const adapter: BrowserAdapter = { launch: async options => ({ id: 'one', snapshot: async () => ({ id: 'one', status: 'ready' }), navigate: async () => undefined, close: async () => undefined }) };
    const runtime = new BrowserRuntime({ adapter, userDataRoot: 'tmp' });
    await runtime.open('one');
    runtime.takeUserControl('one');
    expect(() => runtime.takeUserControl('one')).not.toThrow();
    expect(runtime.controlState('one')).toBe('user_control');
    expect(runtime.list()).toEqual([{ id: 'one', status: 'user_control' }]);
    await expect(runtime.navigate('one', 'https://example.com')).rejects.toThrow('USER_CONTROL_ACTIVE');
    runtime.releaseUserControl('one');
    await expect(runtime.navigate('one', 'https://example.com')).resolves.toBeDefined();
  });

  it('reuses an existing browser session when opened again', async () => {
    const runtime = new BrowserRuntime({ userDataRoot: 'tmp', adapter: { launch: async () => ({ id: 'one', snapshot: async () => ({ id: 'one', status: 'ready' }), close: async () => undefined }) } });
    await runtime.open('one');
    await expect(runtime.open('one')).resolves.toMatchObject({ id: 'one', status: 'ready' });
  });
});

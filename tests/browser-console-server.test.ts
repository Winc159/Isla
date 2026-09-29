import { describe, expect, it } from 'vitest';
import { BrowserConsoleServer } from '../src/browser/console-server.js';
import { BrowserRuntime } from '../src/browser/runtime.js';

describe('BrowserConsoleServer', () => {
  it('allocates a loopback port and protects session listing', async () => {
    const runtime = new BrowserRuntime({ userDataRoot: 'tmp', adapter: { launch: async () => ({ id: 'x', snapshot: async () => ({ id: 'x', status: 'ready' }), close: async () => undefined }) } });
    const server = new BrowserConsoleServer({ runtime });
    const address = await server.start();
    try {
      const base = `http://${address.host}:${address.port}`;
      await expect((await fetch(`${base}/browser/sessions`)).status).toBe(401);
      const response = await fetch(`${base}/browser/sessions`, { headers: { authorization: `Bearer ${address.token}` } });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ sessions: [] });
    } finally { await server.close(); }
  });

  it('exposes authenticated control takeover endpoints', async () => {
    const runtime = new BrowserRuntime({ userDataRoot: 'tmp', adapter: { launch: async () => ({ id: 'x', snapshot: async () => ({ id: 'x', status: 'ready' }), close: async () => undefined }) } });
    await runtime.open('x');
    const server = new BrowserConsoleServer({ runtime }); const address = await server.start();
    try {
      const headers = { authorization: `Bearer ${address.token}` };
      const take = await fetch(`http://${address.host}:${address.port}/browser/sessions/x/control/take`, { method: 'POST', headers });
      expect(take.status).toBe(200); await expect(take.json()).resolves.toMatchObject({ control: 'user_control' });
      const release = await fetch(`http://${address.host}:${address.port}/browser/sessions/x/control/release`, { method: 'POST', headers });
      expect(release.status).toBe(200); await expect(release.json()).resolves.toMatchObject({ control: 'agent_control' });
    } finally { await server.close(); }
  });
});

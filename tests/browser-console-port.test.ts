import { describe, expect, it } from 'vitest';
import { reserveBrowserConsolePort } from '../src/browser/console-port.js';

describe('Browser Console port allocation', () => {
  it('allocates an available loopback port by default', async () => {
    const reservation = await reserveBrowserConsolePort();
    expect(reservation.host).toBe('127.0.0.1');
    expect(reservation.port).toBeGreaterThan(0);
    await reservation.release();
  });

  it('rejects non-loopback binding', async () => {
    await expect(reserveBrowserConsolePort({ host: '0.0.0.0' })).rejects.toThrow('loopback');
  });
});

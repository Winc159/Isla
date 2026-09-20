import { describe, expect, it } from 'vitest';
import { PtyDriver } from './pty-driver.js';

describe('PtyDriver', () => {
  it('starts a real TTY child and exchanges input/output', async () => {
    const driver = new PtyDriver(process.execPath, ['-e', 'process.stdout.write(String(process.stdin.isTTY)); process.stdin.on("data", d => { process.stdout.write(d.toString()); if (d.toString().includes("bye")) process.exit(0); });'], { cwd: process.cwd() });
    try {
      await driver.waitForText('true');
      driver.enter('bye');
      await driver.waitForText('bye');
      expect((await driver.waitForExit()).exitCode).toBe(0);
    } finally { await driver.dispose(); }
  }, 15_000);
});

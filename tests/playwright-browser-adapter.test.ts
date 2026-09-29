import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { PlaywrightBrowserAdapter } from '../src/browser/playwright-adapter.js';

const runRealBrowser = process.env.ISLA_RUN_BROWSER_REAL === '1';

describe('PlaywrightBrowserAdapter', () => {
  it.skipIf(!runRealBrowser)('launches an isolated persistent session and performs basic actions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'isla-browser-'));
    try {
      const adapter = new PlaywrightBrowserAdapter();
      const handle = await adapter.launch({ userDataDirectory: root, headless: true });
      await handle.navigate?.('data:text/html,<title>Isla</title><button data-testid="go">Go</button><input data-testid="name">');
      await handle.type?.('name', 'tester');
      await handle.click?.('go');
      await expect(handle.snapshot()).resolves.toMatchObject({ id: root, title: 'Isla', status: 'ready' });
      await handle.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.env.ISLA_RUN_BILIBILI_REAL !== '1')('opens Bilibili and reads the page state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'isla-bilibili-'));
    try {
      const handle = await new PlaywrightBrowserAdapter().launch({ userDataDirectory: root, headless: true });
      await handle.navigate?.('https://www.bilibili.com/');
      const snapshot = await handle.snapshot();
      expect(snapshot.url).toContain('bilibili.com');
      expect(snapshot.title).toBeTruthy();
      const screenshot = await handle.screenshot?.();
      if (screenshot) { const output = join(process.cwd(), '.isla-local', 'evaluations', 'bilibili-real-eval.png'); await mkdir(join(process.cwd(), '.isla-local', 'evaluations'), { recursive: true }); await writeFile(output, screenshot); console.log(JSON.stringify({ site: 'bilibili', url: snapshot.url, title: snapshot.title, screenshot: output, actions: ['navigate', 'observe', 'screenshot'] })); }
      await handle.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});

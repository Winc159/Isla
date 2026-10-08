import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlaywrightBrowserAdapter } from '../src/browser/playwright-adapter.js';

const enabled = process.env.ISLA_RUN_LOGIN_SITES_REAL === '1';
const targets = [
  ['github', 'https://github.com/login'],
  ['google', 'https://accounts.google.com/'],
  ['microsoft', 'https://login.microsoftonline.com/'],
  ['reddit', 'https://www.reddit.com/login/'],
  ['x', 'https://x.com/i/flow/login'],
] as const;

describe('real login-site connectivity via Isla', () => {
  it.skipIf(!enabled)('opens common login entry points without submitting credentials', async () => {
    const results: Array<Record<string, unknown>> = [];
    for (const [name, target] of targets) {
      const root = await mkdtemp(join(tmpdir(), `isla-login-${name}-`));
      const started = Date.now();
      try {
        const handle = await new PlaywrightBrowserAdapter().launch({ userDataDirectory: root, headless: true });
        try {
          await handle.navigate?.(target);
          const snapshot = await handle.snapshot();
          const safeUrl = snapshot.url ? (() => { const parsed = new URL(snapshot.url); return `${parsed.origin}${parsed.pathname}`; })() : undefined;
          results.push({ name, target, ok: true, url: safeUrl, title: snapshot.title, elapsedMs: Date.now() - started });
        } catch (error) { results.push({ name, target, ok: false, error: error instanceof Error ? error.message : String(error), elapsedMs: Date.now() - started }); }
        await handle.close();
      } catch (error) { results.push({ name, target, ok: false, error: error instanceof Error ? error.message : String(error), elapsedMs: Date.now() - started }); }
      await rm(root, { recursive: true, force: true });
    }
    const report = { kind: 'isla-login-site-connectivity', generatedAt: new Date().toISOString(), results };
    await mkdir(join(process.cwd(), '.isla-local', 'evaluations'), { recursive: true });
    await writeFile(join(process.cwd(), '.isla-local', 'evaluations', 'login-sites-connectivity-real.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    expect(results).toHaveLength(targets.length);
    expect(results.find(result => result.name === 'github')).toMatchObject({ ok: true });
  }, 180_000);
});

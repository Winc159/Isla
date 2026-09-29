import { chromium, type BrowserContext, type Page } from 'playwright';
import { randomUUID } from 'node:crypto';
import type { BrowserAdapter, BrowserLaunchOptions, BrowserSessionHandle, BrowserElementRef } from './types.js';

export class PlaywrightBrowserAdapter implements BrowserAdapter {
  async launch(options: BrowserLaunchOptions): Promise<BrowserSessionHandle> {
    const context = await chromium.launchPersistentContext(options.userDataDirectory, {
      headless: options.headless ?? true,
      acceptDownloads: options.downloadsEnabled === true,
      ...(options.executablePath ? { executablePath: options.executablePath } : {}),
    });
    const page = context.pages()[0] ?? await context.newPage();
    return createHandle(context, page, options.userDataDirectory.split(/[\\/]/).filter(Boolean).at(-1) ?? options.userDataDirectory);
  }
}

function createHandle(context: BrowserContext, page: Page, id: string): BrowserSessionHandle {
  let activePage = page;
  let tabId = randomUUID();
  let documentId = randomUUID();
  let snapshotId = randomUUID();
  const refreshDocument = () => { documentId = randomUUID(); snapshotId = randomUUID(); };
  const watch = (next: Page) => { next.on('framenavigated', frame => { if (frame === next.mainFrame() && next === activePage) refreshDocument(); }); };
  watch(page);
  context.on('page', next => { activePage = next; tabId = randomUUID(); refreshDocument(); watch(next); });
  const current = () => activePage;
  return {
    id,
    snapshot: async () => ({ id, status: 'ready', tabId, documentId, snapshotId, url: current().url(), title: await current().title() }),
    observe: async () => observePage(current(), tabId, documentId),
    find: async (query, maxMatches = 10) => (await observePage(current(), tabId, documentId)).filter(item => `${item.name ?? ''} ${item.text ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, Math.min(10, Math.max(1, maxMatches))),
    read: async (cursor, maxChars = 3500) => { const text = (await current().locator('body').innerText()).replace(/\s+/g, ' ').trim(); const start = cursor ? Number.parseInt(cursor, 10) : 0; const safeStart = Number.isFinite(start) && start >= 0 ? start : 0; const end = Math.min(text.length, safeStart + Math.min(3500, Math.max(1, maxChars))); return { text: text.slice(safeStart, end), truncated: end < text.length, ...(end < text.length ? { cursor: String(end) } : {}) }; },
    readText: async () => (await current().locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 8000),
    links: async (maxLinks = 30) => current().locator('a[href]').evaluateAll((nodes, limit) => nodes.slice(0, limit).map(node => { const text = ((node as HTMLElement).innerText || node.getAttribute('aria-label') || '').trim().slice(0, 240); const imageAlt = node.querySelector('img')?.getAttribute('alt') || ''; return { href: (node as HTMLAnchorElement).href, ...(text ? { text } : {}), ...(imageAlt ? { imageAlt } : {}) }; }), Math.min(100, Math.max(1, maxLinks))),
    navigate: async url => { await current().goto(url, { waitUntil: 'domcontentloaded' }); },
    screenshot: async () => current().screenshot({ type: 'png', animations: 'disabled', timeout: 10_000 }),
    click: async ref => { await elementByRef(current(), ref).click(); },
    type: async (ref, text) => { await elementByRef(current(), ref).fill(text); },
    select: async (ref, value) => { await elementByRef(current(), ref).selectOption(value); },
    wait: async milliseconds => { await current().waitForTimeout(milliseconds); },
    scroll: async deltaY => { await current().mouse.wheel(0, deltaY); },
    back: async () => { await current().goBack({ waitUntil: 'domcontentloaded' }); },
    close: async () => { await context.close().catch(() => undefined); },
  };
}

async function observePage(page: Page, tabId: string, documentId: string): Promise<readonly BrowserElementRef[]> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { await page.waitForLoadState('domcontentloaded', { timeout: 3_000 }).catch(() => undefined); return await page.locator('a,button,input,textarea,select,[role]').evaluateAll((elements, context) => elements.filter(element => { const rect = (element as HTMLElement).getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }).slice(0, 40).map((element, index) => {
    const node = element as HTMLElement;
    const input = node as HTMLInputElement;
    const role = node.getAttribute('role') ?? node.tagName.toLowerCase();
    const label = node.getAttribute('aria-label') || node.getAttribute('title') || node.getAttribute('placeholder') || node.querySelector('img')?.getAttribute('alt') || '';
    const text = (node.innerText || label).trim().slice(0, 160);
    const ref = `e${index + 1}`;
    node.setAttribute('data-isla-ref', ref);
    const description = [node.getAttribute('aria-describedby'), node.getAttribute('placeholder')].filter(Boolean).join(' ').slice(0, 160);
    return { ref, role, disabled: (node as HTMLButtonElement).disabled === true, tabId: context.tabId, documentId: context.documentId, ...(text ? { text } : {}), ...(description ? { description } : {}), ...((node as HTMLAnchorElement).href ? { href: (node as HTMLAnchorElement).href } : {}), ...(input.type && input.type !== 'password' ? { inputType: input.type } : {}), ...(node.getAttribute('name') ? { name: node.getAttribute('name')! } : {}) };
    }), { tabId, documentId }); } catch (error) { if (attempt === 2 || !/Execution context was destroyed|navigation/i.test(error instanceof Error ? error.message : String(error))) throw error; await page.waitForTimeout(250); }
  }
  return [];
}

function elementByRef(page: Page, ref: string) {
  if (!/^e\d+$/.test(ref)) throw new Error('BROWSER_ELEMENT_REF_INVALID');
  return page.locator(`[data-isla-ref="${ref}"]`).first();
}

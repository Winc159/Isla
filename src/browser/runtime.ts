import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateBrowserUrl } from './url-policy.js';
import type { BrowserAdapter, BrowserLaunchOptions, BrowserSessionHandle, BrowserSessionSnapshot, BrowserElementRef } from './types.js';

export interface BrowserRuntimeOptions {
  readonly adapter: BrowserAdapter;
  readonly userDataRoot: string;
  readonly maxSessions?: number;
  readonly headless?: boolean;
  readonly presentation?: 'native' | 'console' | 'auto';
  readonly onEvent?: (event: { readonly type: string; readonly sessionId: string; readonly controlEpoch?: number; readonly code?: string }) => void;
}

export interface BrowserControlLease {
  readonly sessionId: string;
  readonly controlEpoch: number;
  readonly owner: 'agent' | 'user';
  readonly status: 'active' | 'released';
}

export class BrowserRuntime {
  private readonly sessions = new Map<string, BrowserSessionHandle>();
  private readonly controls = new Map<string, 'agent_control' | 'user_control'>();
  private readonly epochs = new Map<string, number>();
  private readonly launches = new Map<string, Omit<BrowserLaunchOptions, 'userDataDirectory'>>();
  private readonly refs = new Map<string, { tabId?: string; documentId?: string; elements: ReadonlyMap<string, BrowserElementRef> }>();
  private readonly maxSessions: number;

  constructor(private readonly options: BrowserRuntimeOptions) {
    this.maxSessions = options.maxSessions ?? 1;
    if (!Number.isInteger(this.maxSessions) || this.maxSessions <= 0) throw new Error('maxSessions must be a positive integer');
  }

  async open(id: string, launch: Omit<BrowserLaunchOptions, 'userDataDirectory'> = {}): Promise<BrowserSessionSnapshot> {
    if (this.sessions.has(id)) return this.snapshot(id);
    if (this.sessions.size >= this.maxSessions) throw new Error('Browser session limit reached');
    const userDataDirectory = `${this.options.userDataRoot}/${id}`;
    await mkdir(userDataDirectory, { recursive: true });
    try {
      const handle = await this.options.adapter.launch({ ...launch, headless: launch.headless ?? this.resolveHeadless(), userDataDirectory });
      this.sessions.set(id, handle);
      this.launches.set(id, launch);
      this.controls.set(id, 'agent_control');
      this.epochs.set(id, 0);
      this.options.onEvent?.({ type: 'browser_opened', sessionId: id });
      return await handle.snapshot();
    } catch (error) {
      await this.closeDirectory(userDataDirectory);
      throw error;
    }
  }

  async reopen(id: string): Promise<BrowserSessionSnapshot> {
    if (this.sessions.has(id)) return this.snapshot(id);
    const result = await this.open(id, this.launches.get(id) ?? {});
    this.options.onEvent?.({ type: 'browser_reopened', sessionId: id });
    return result;
  }

  requireHandleForRead(id: string): BrowserSessionHandle { return this.require(id); }

  async snapshot(id: string): Promise<BrowserSessionSnapshot> {
    return this.require(id).snapshot();
  }

  async navigate(id: string, url: string): Promise<BrowserSessionSnapshot> {
    this.assertAgentControl(id);
    const handle = this.require(id);
    if (!handle.navigate) throw new Error('BROWSER_NAVIGATE_UNAVAILABLE');
    const parsed = validateBrowserUrl(url, { allowLoopback: url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost') || url.startsWith('http://[::1]') });
    await handle.navigate(parsed.toString());
    return handle.snapshot();
  }

  async screenshot(id: string): Promise<Buffer> { const handle = this.require(id); if (!handle.screenshot) throw new Error('BROWSER_SCREENSHOT_UNAVAILABLE'); return handle.screenshot(); }
  async observe(id: string): Promise<readonly BrowserElementRef[]> { const handle = this.require(id); if (!handle.observe) throw new Error('BROWSER_OBSERVE_UNAVAILABLE'); const result = await handle.observe(); const snapshot = await handle.snapshot(); this.refs.set(id, { ...(snapshot.tabId ? { tabId: snapshot.tabId } : {}), ...(snapshot.documentId ? { documentId: snapshot.documentId } : {}), elements: new Map(result.map(item => [item.ref, item])) }); return result; }
  async find(id: string, query: string, maxMatches = 10): Promise<readonly BrowserElementRef[]> { const handle = this.require(id); if (!handle.find) throw new Error('BROWSER_FIND_UNAVAILABLE'); const result = await handle.find(query, maxMatches); const snapshot = await handle.snapshot(); this.refs.set(id, { ...(snapshot.tabId ? { tabId: snapshot.tabId } : {}), ...(snapshot.documentId ? { documentId: snapshot.documentId } : {}), elements: new Map(result.map(item => [item.ref, item])) }); return result; }
  async read(id: string, cursor?: string, maxChars = 3500) { const handle = this.require(id); if (handle.read) return handle.read(cursor, maxChars); if (!handle.readText) throw new Error('BROWSER_READ_UNAVAILABLE'); const text = (await handle.readText()).slice(0, Math.min(3500, maxChars)); return { text, truncated: text.length >= maxChars, ...(text.length >= maxChars ? { cursor: String(text.length) } : {}) }; }
  async readText(id: string): Promise<string> { return (await this.read(id)).text; }
  async click(id: string, ref: string, context?: { tabId?: string; documentId?: string }): Promise<BrowserSessionSnapshot> { this.assertAgentControl(id); this.assertRef(id, ref, context); const handle = this.require(id); if (!handle.click) throw new Error('BROWSER_CLICK_UNAVAILABLE'); await handle.click(ref); return handle.snapshot(); }
  async type(id: string, ref: string, text: string, context?: { tabId?: string; documentId?: string }): Promise<BrowserSessionSnapshot> { this.assertAgentControl(id); this.assertRef(id, ref, context); const handle = this.require(id); if (!handle.type) throw new Error('BROWSER_TYPE_UNAVAILABLE'); await handle.type(ref, text); return handle.snapshot(); }
  async userClick(id: string, ref: string): Promise<BrowserSessionSnapshot> { this.assertUserControl(id); const handle = this.require(id); if (!handle.click) throw new Error('BROWSER_CLICK_UNAVAILABLE'); await handle.click(ref); return handle.snapshot(); }
  async userType(id: string, ref: string, text: string): Promise<BrowserSessionSnapshot> { this.assertUserControl(id); const handle = this.require(id); if (!handle.type) throw new Error('BROWSER_TYPE_UNAVAILABLE'); await handle.type(ref, text); return handle.snapshot(); }
  async typeSecret(id: string, ref: string, secret: string, context: { tabId: string; documentId: string }): Promise<void> { this.assertAgentControl(id); const element = this.assertRef(id, ref, context); if (element.inputType !== 'password' && !/password|passwd|otp|token|secret|验证码/i.test(`${element.name ?? ''} ${element.text ?? ''}`)) throw new Error('BROWSER_SECRET_TARGET_INVALID'); const handle = this.require(id); if (!handle.type) throw new Error('BROWSER_TYPE_UNAVAILABLE'); await handle.type(ref, secret); }
  async select(id: string, ref: string, value: string, context?: { tabId?: string; documentId?: string }): Promise<BrowserSessionSnapshot> { this.assertAgentControl(id); this.assertRef(id, ref, context); const handle = this.require(id); if (!handle.select) throw new Error('BROWSER_SELECT_UNAVAILABLE'); await handle.select(ref, value); return handle.snapshot(); }
  async wait(id: string, milliseconds: number): Promise<BrowserSessionSnapshot> { this.assertAgentControl(id); const handle = this.require(id); if (!handle.wait) throw new Error('BROWSER_WAIT_UNAVAILABLE'); await handle.wait(Math.min(Math.max(milliseconds, 0), 30_000)); return handle.snapshot(); }
  async scroll(id: string, deltaY: number): Promise<BrowserSessionSnapshot> { this.assertAgentControl(id); const handle = this.require(id); if (!handle.scroll) throw new Error('BROWSER_SCROLL_UNAVAILABLE'); await handle.scroll(Math.max(-5000, Math.min(5000, deltaY))); return handle.snapshot(); }
  async back(id: string): Promise<BrowserSessionSnapshot> { this.assertAgentControl(id); const handle = this.require(id); if (!handle.back) throw new Error('BROWSER_BACK_UNAVAILABLE'); await handle.back(); return handle.snapshot(); }

  async close(id: string): Promise<void> {
    const handle = this.sessions.get(id);
    if (!handle) return;
    this.sessions.delete(id);
    this.controls.delete(id);
    this.epochs.delete(id);
    this.options.onEvent?.({ type: 'browser_closed', sessionId: id });
    await handle.close();
  }

  controlState(id: string): 'agent_control' | 'user_control' { this.require(id); return this.controls.get(id) ?? 'agent_control'; }
  takeUserControl(id: string): BrowserControlLease { this.require(id); const epoch = this.epochs.get(id) ?? 0; if (this.controls.get(id) === 'user_control') return { sessionId: id, controlEpoch: epoch, owner: 'user', status: 'active' }; const next = epoch + 1; this.epochs.set(id, next); this.controls.set(id, 'user_control'); this.options.onEvent?.({ type: 'user_control_started', sessionId: id, controlEpoch: next }); return { sessionId: id, controlEpoch: next, owner: 'user', status: 'active' }; }
  releaseUserControl(id: string, controlEpoch?: number): BrowserControlLease { this.require(id); const epoch = this.epochs.get(id) ?? 0; if (controlEpoch !== undefined && controlEpoch !== epoch) throw new Error('BROWSER_CONTROL_EPOCH_STALE'); this.controls.set(id, 'agent_control'); this.options.onEvent?.({ type: 'user_control_released', sessionId: id, controlEpoch: epoch }); return { sessionId: id, controlEpoch: epoch, owner: 'agent', status: 'released' }; }
  private assertAgentControl(id: string): void { if (this.controlState(id) !== 'agent_control') throw new Error('BROWSER_USER_CONTROL_ACTIVE'); }
  private assertUserControl(id: string): void { if (this.controlState(id) !== 'user_control') throw new Error('BROWSER_AGENT_CONTROL_ACTIVE'); }
  private resolveHeadless(): boolean { if (this.options.presentation === 'native') return false; if (this.options.presentation === 'console') return true; if (this.options.headless !== undefined) return this.options.headless; if (process.platform === 'win32' || process.platform === 'darwin') return false; return !(process.env.DISPLAY || process.env.WAYLAND_DISPLAY); }
  async waitForControl(id: string, state: 'agent_control' | 'user_control', signal?: AbortSignal): Promise<void> { while (this.controlState(id) !== state) { if (signal?.aborted) throw new Error('BROWSER_CONTROL_WAIT_CANCELLED'); await new Promise(resolve => setTimeout(resolve, 100)); } }
  private assertRef(id: string, ref: string, context?: { tabId?: string; documentId?: string }): BrowserElementRef { const known = this.refs.get(id); const element = known?.elements.get(ref); if (!known || !element) throw new Error('BROWSER_STALE_REF'); if (context?.tabId && known.tabId !== context.tabId || context?.documentId && known.documentId !== context.documentId) throw new Error('BROWSER_STALE_REF'); return element; }

  async closeAll(): Promise<void> {
    const ids = [...this.sessions.keys()];
    for (const id of ids) await this.close(id);
  }

  list(): readonly BrowserSessionSnapshot[] {
    return [...this.sessions.keys()].map(id => ({ id, status: this.controls.get(id) ?? 'agent_control' }));
  }

  private require(id: string): BrowserSessionHandle {
    const handle = this.sessions.get(id);
    if (!handle) throw new Error(`Browser session not found: ${id}`);
    return handle;
  }

  private async closeDirectory(_path: string): Promise<void> {
    // Batch A deliberately does not remove profile data; persistence policy is Batch B.
  }
}

export async function findChromiumExecutable(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const candidates = [env.ISLA_BROWSER_EXECUTABLE, ...((env.PATH ?? '').split(delimiter).flatMap(path => ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'].map(name => `${path}/${name}`)))].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* continue */ }
  }
  return undefined;
}

export async function browserCheck(env: NodeJS.ProcessEnv = process.env): Promise<{ readonly available: boolean; readonly executable?: string }> {
  const executable = await findChromiumExecutable(env);
  return executable ? { available: true, executable } : { available: false };
}

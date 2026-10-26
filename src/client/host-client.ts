import type { HostTurnEvent } from '../host/server.js';

export interface QuickPromptStreamOptions {
  readonly text: string;
  readonly workspaceKey: string;
  readonly workspaceRoot: string;
  readonly newSession?: boolean;
  readonly onEvent: (event: HostTurnEvent) => void;
  readonly signal?: AbortSignal;
}

export class ResidentHostClient {
  constructor(private readonly baseURL: string, private readonly token: string) {}
  async health(): Promise<unknown> { return this.request('/health', false); }
  async capabilities(): Promise<unknown> { return this.request('/capabilities'); }
  async sessions(): Promise<unknown> { return this.request('/sessions'); }
  async createSession(prompt?: string): Promise<unknown> { return this.request('/sessions', true, prompt === undefined ? {} : { prompt }); }
  async quickPrompt(text: string, workspaceKey: string, workspaceRoot: string, newSession = false): Promise<{ readonly sessionId: string; readonly text: string }> { return this.request('/quick', true, { text, workspaceKey, workspaceRoot, newSession }) as Promise<{ readonly sessionId: string; readonly text: string }>; }
  async quickPromptStream(options: QuickPromptStreamOptions): Promise<Extract<HostTurnEvent, { readonly type: 'turn_completed' }>> {
    const response = await fetch(`${this.baseURL}/quick`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', accept: 'application/x-ndjson' },
      body: JSON.stringify({ text: options.text, workspaceKey: options.workspaceKey, workspaceRoot: options.workspaceRoot, newSession: options.newSession ?? false }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) throw new Error(`HOST_HTTP_${response.status}`);
    if (!response.body) throw new Error('HOST_STREAM_UNAVAILABLE');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let terminal: Extract<HostTurnEvent, { readonly type: 'turn_completed' }> | undefined;
    try {
      while (true) {
        const part = await reader.read();
        pending += decoder.decode(part.value, { stream: !part.done });
        let newline = pending.indexOf('\n');
        while (newline >= 0) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          if (line) {
            const event = parseHostTurnEvent(line);
            options.onEvent(event);
            if (event.type === 'turn_completed') terminal = event;
            if (event.type === 'turn_failed') throw new Error(event.code);
            if (event.type === 'turn_cancelled') throw new Error('TURN_CANCELLED');
          }
          newline = pending.indexOf('\n');
        }
        if (part.done) break;
      }
    } finally { reader.releaseLock(); }
    if (pending.trim()) {
      const event = parseHostTurnEvent(pending);
      options.onEvent(event);
      if (event.type === 'turn_completed') terminal = event;
      if (event.type === 'turn_failed') throw new Error(event.code);
      if (event.type === 'turn_cancelled') throw new Error('TURN_CANCELLED');
    }
    if (!terminal) throw new Error('HOST_STREAM_TERMINAL_MISSING');
    return terminal;
  }
  async prompt(sessionId: string, text: string): Promise<unknown> { return this.request(`/sessions/${encodeURIComponent(sessionId)}/prompt`, true, { text }); }
  async cancel(sessionId: string, turnId: string): Promise<{ readonly accepted: boolean }> { return this.request(`/sessions/${encodeURIComponent(sessionId)}/cancel`, true, { turnId }) as Promise<{ readonly accepted: boolean }>; }
  async events(sessionId: string): Promise<string> { const response = await fetch(`${this.baseURL}/sessions/${encodeURIComponent(sessionId)}/events`, { headers: { authorization: `Bearer ${this.token}` } }); if (!response.ok) throw new Error(`HOST_HTTP_${response.status}`); return response.text(); }
  private async request(path: string, auth = true, body?: unknown): Promise<unknown> { const response = await fetch(`${this.baseURL}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(auth ? { authorization: `Bearer ${this.token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); if (!response.ok) throw new Error(`HOST_HTTP_${response.status}`); return response.json(); }
}

function parseHostTurnEvent(line: string): HostTurnEvent {
  let value: unknown;
  try { value = JSON.parse(line); } catch { throw new Error('HOST_STREAM_INVALID_EVENT'); }
  if (!value || typeof value !== 'object' || !('type' in value) || typeof value.type !== 'string') throw new Error('HOST_STREAM_INVALID_EVENT');
  const type = value.type;
  if (!['turn_start', 'model_step_start', 'model_delta', 'model_step_end', 'tool_start', 'tool_end', 'turn_completed', 'turn_failed', 'turn_cancelled'].includes(type)) throw new Error('HOST_STREAM_UNKNOWN_EVENT');
  return value as HostTurnEvent;
}

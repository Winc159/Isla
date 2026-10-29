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
  async resolveWorkspace(workspaceRoot: string): Promise<{ readonly workspaceRoot: string; readonly workspaceKey: string }> { return this.request('/workspace/resolve', true, { workspaceRoot }) as Promise<{ readonly workspaceRoot: string; readonly workspaceKey: string }>; }
  async health(): Promise<unknown> { return this.request('/health', false); }
  async capabilities(): Promise<unknown> { return this.request('/capabilities'); }
  async sessions(workspaceKey?: string, query = '', archived = false): Promise<{ readonly sessions: readonly { readonly sessionId: string; readonly provider: string; readonly model: string; readonly updatedAt: string; readonly archivedAt?: string; readonly match?: string }[] }> { const params = new URLSearchParams(); if (workspaceKey) params.set('workspaceKey', workspaceKey); if (query.trim()) params.set('q', query.trim()); if (archived) params.set('archived', 'true'); return this.request(`/sessions${params.size ? `?${params}` : ''}`) as Promise<{ readonly sessions: readonly { readonly sessionId: string; readonly provider: string; readonly model: string; readonly updatedAt: string; readonly archivedAt?: string; readonly match?: string }[] }>; }
  async setSessionArchived(sessionId: string, archived: boolean): Promise<unknown> { return this.request(`/sessions/${encodeURIComponent(sessionId)}/archive`, true, { archived }); }
  async createSession(workspaceKey: string): Promise<{ readonly sessionId: string }> { return this.request('/sessions', true, { workspaceKey }) as Promise<{ readonly sessionId: string }>; }
  async quickPrompt(text: string, workspaceKey: string, workspaceRoot: string, newSession = false): Promise<{ readonly sessionId: string; readonly text: string }> { return this.request('/quick', true, { text, workspaceKey, workspaceRoot, newSession }) as Promise<{ readonly sessionId: string; readonly text: string }>; }
  async quickPromptStream(options: QuickPromptStreamOptions): Promise<Extract<HostTurnEvent, { readonly type: 'turn_completed' }>> {
    return this.stream('/quick', { text: options.text, workspaceKey: options.workspaceKey, workspaceRoot: options.workspaceRoot, newSession: options.newSession ?? false }, options.onEvent, options.signal);
  }
  async promptStream(sessionId: string, text: string, workspaceRoot: string, onEvent: (event: HostTurnEvent) => void, signal?: AbortSignal): Promise<Extract<HostTurnEvent, { readonly type: 'turn_completed' }>> {
    return this.stream(`/sessions/${encodeURIComponent(sessionId)}/prompt`, { text, workspaceRoot }, onEvent, signal);
  }
  async respond(sessionId: string, interactionId: string, turnId: string, response: Record<string, unknown>): Promise<{ readonly accepted: boolean }> { return this.request(`/sessions/${encodeURIComponent(sessionId)}/interactions/${encodeURIComponent(interactionId)}`, true, { ...response, turnId }) as Promise<{ readonly accepted: boolean }>; }
  async history(sessionId: string, offset = 0, limit = 50): Promise<{ readonly messages: readonly { role: string; content: string }[]; readonly total: number; readonly offset: number }> { return this.request(`/sessions/${encodeURIComponent(sessionId)}/history?offset=${offset}&limit=${limit}`) as Promise<{ readonly messages: readonly { role: string; content: string }[]; readonly total: number; readonly offset: number }>; }
  async sessionView(sessionId: string, view: 'trace' | 'context'): Promise<unknown> { return this.request(`/sessions/${encodeURIComponent(sessionId)}/${view}`); }
  async workPlan(sessionId: string): Promise<{ readonly plan?: import('../core/work-plan.js').WorkPlanV1; readonly mode?: import('../core/work-plan.js').WorkModeStateV1 }> { return this.request(`/sessions/${encodeURIComponent(sessionId)}/plan`) as Promise<{ readonly plan?: import('../core/work-plan.js').WorkPlanV1; readonly mode?: import('../core/work-plan.js').WorkModeStateV1 }>; }
  async updateWorkPlan(sessionId: string, workspaceRoot: string, plan: import('../core/work-plan.js').WorkPlanV1, expectedRevision: number): Promise<unknown> { return this.request(`/sessions/${encodeURIComponent(sessionId)}/plan`, true, { action:'update', workspaceRoot, plan, expectedRevision }); }
  async setWorkMode(sessionId: string, workspaceRoot: string, mode: import('../core/work-plan.js').WorkMode, approvePlanRevision?: number): Promise<unknown> { return this.request(`/sessions/${encodeURIComponent(sessionId)}/plan`, true, { action:'mode', workspaceRoot, mode, ...(approvePlanRevision === undefined ? {} : { approvePlanRevision }) }); }
  async checkpoints(sessionId: string, workspaceRoot: string): Promise<{readonly checkpoints: readonly {readonly id:string;readonly createdAt:string;readonly gitHead?:string}[]}> { return this.request(`/sessions/${encodeURIComponent(sessionId)}/checkpoints?workspaceRoot=${encodeURIComponent(workspaceRoot)}`) as Promise<{readonly checkpoints: readonly {readonly id:string;readonly createdAt:string;readonly gitHead?:string}[]}>; }
  async checkpointOperation(sessionId:string,workspaceRoot:string,action:'preview'|'restore',id:string,approved=false):Promise<unknown>{return this.request(`/sessions/${encodeURIComponent(sessionId)}/checkpoints`,true,{workspaceRoot,action,id,approved});}
  async processes(sessionId: string, workspaceRoot: string): Promise<{ readonly processes: readonly { readonly processId: string; readonly state: string; readonly adapter: string; readonly tty: boolean; readonly workdir: string; readonly outputCursor: number; readonly outputBytes: number; readonly exitCode?: number | null }[] }> { return this.request(`/sessions/${encodeURIComponent(sessionId)}/processes?workspaceRoot=${encodeURIComponent(workspaceRoot)}`) as Promise<{ readonly processes: readonly { readonly processId: string; readonly state: string; readonly adapter: string; readonly tty: boolean; readonly workdir: string; readonly outputCursor: number; readonly outputBytes: number; readonly exitCode?: number | null }[] }>; }
  async processOutput(sessionId: string, processId: string, workspaceRoot: string, afterCursor = 0): Promise<{ readonly events: readonly { readonly sequence: number; readonly stream: 'stdout' | 'stderr'; readonly text: string }[]; readonly cursor: number; readonly truncated: boolean }> { return this.request(`/sessions/${encodeURIComponent(sessionId)}/processes/${encodeURIComponent(processId)}/output?workspaceRoot=${encodeURIComponent(workspaceRoot)}&after=${afterCursor}`) as Promise<{ readonly events: readonly { readonly sequence: number; readonly stream: 'stdout' | 'stderr'; readonly text: string }[]; readonly cursor: number; readonly truncated: boolean }>; }
  async memory(action = 'list', id?: string): Promise<unknown> { return this.request(`/memory?action=${encodeURIComponent(action)}${id ? `&id=${encodeURIComponent(id)}` : ''}`); }
  async disableMemory(id: string, expectedRevision: number): Promise<unknown> { return this.request(`/memory/${encodeURIComponent(id)}`, true, { expectedRevision }); }
  private async stream(path: string, body: unknown, onEvent: (event: HostTurnEvent) => void, signal?: AbortSignal): Promise<Extract<HostTurnEvent, { readonly type: 'turn_completed' }>> {
    const response = await fetch(`${this.baseURL}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', accept: 'application/x-ndjson' },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
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
            onEvent(event);
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
      onEvent(event);
      if (event.type === 'turn_completed') terminal = event;
      if (event.type === 'turn_failed') throw new Error(event.code);
      if (event.type === 'turn_cancelled') throw new Error('TURN_CANCELLED');
    }
    if (!terminal) throw new Error('HOST_STREAM_TERMINAL_MISSING');
    return terminal;
  }
  async prompt(sessionId: string, text: string): Promise<unknown> { return this.request(`/sessions/${encodeURIComponent(sessionId)}/prompt`, true, { text }); }
  async cancel(sessionId: string, turnId: string): Promise<{ readonly accepted: boolean }> { return this.request(`/sessions/${encodeURIComponent(sessionId)}/cancel`, true, { turnId }) as Promise<{ readonly accepted: boolean }>; }
  async beginTurn(sessionId: string, text: string, workspaceRoot: string): Promise<{ readonly sessionId: string; readonly turnId: string }> { return this.request(`/sessions/${encodeURIComponent(sessionId)}/turns`, true, { text, workspaceRoot }) as Promise<{ readonly sessionId: string; readonly turnId: string }>; }
  async activeTurn(sessionId: string): Promise<{ readonly active: boolean; readonly turnId?: string; readonly startedAt?: string; readonly queuedFollowUps?: number; readonly followUps?: readonly { readonly id: string; readonly text: string }[]; readonly nextEventSequence?: number; readonly truncated?: boolean }> { return this.request(`/sessions/${encodeURIComponent(sessionId)}/turns/active`) as Promise<{ readonly active: boolean; readonly turnId?: string; readonly startedAt?: string; readonly queuedFollowUps?: number; readonly followUps?: readonly { readonly id: string; readonly text: string }[]; readonly nextEventSequence?: number; readonly truncated?: boolean }>; }
  async followUpTurn(sessionId: string, turnId: string, text: string, id: string): Promise<{ readonly accepted: boolean; readonly duplicate: boolean; readonly queuePosition: number }> { return this.request(`/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/follow-up`, true, { text, id }) as Promise<{ readonly accepted: boolean; readonly duplicate: boolean; readonly queuePosition: number }>; }
  async turnEvents(sessionId: string, turnId: string, after = 0): Promise<{ readonly events: readonly { readonly sequence: number; readonly event: HostTurnEvent | import('../core/events.js').ModelStepEvent }[]; readonly nextSequence: number; readonly firstSequence: number; readonly truncated: boolean; readonly active: boolean }> { return this.request(`/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/events?after=${after}`) as Promise<{ readonly events: readonly { readonly sequence: number; readonly event: HostTurnEvent | import('../core/events.js').ModelStepEvent }[]; readonly nextSequence: number; readonly firstSequence: number; readonly truncated: boolean; readonly active: boolean }>; }
  async cancelTurn(sessionId: string, turnId: string): Promise<{ readonly accepted: boolean }> { return this.request(`/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/cancel`, true, {}) as Promise<{ readonly accepted: boolean }>; }
  async resourceJobs(): Promise<unknown> { return this.request('/resource/jobs'); }
  async mcpStatus(): Promise<unknown> { return this.request('/mcp/status'); }
  async events(sessionId: string): Promise<string> { const response = await fetch(`${this.baseURL}/sessions/${encodeURIComponent(sessionId)}/events`, { headers: { authorization: `Bearer ${this.token}` } }); if (!response.ok) throw new Error(`HOST_HTTP_${response.status}`); return response.text(); }
  private async request(path: string, auth = true, body?: unknown): Promise<unknown> { const response = await fetch(`${this.baseURL}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(auth ? { authorization: `Bearer ${this.token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); if (!response.ok) throw new Error(`HOST_HTTP_${response.status}`); return response.json(); }
}

function parseHostTurnEvent(line: string): HostTurnEvent {
  let value: unknown;
  try { value = JSON.parse(line); } catch { throw new Error('HOST_STREAM_INVALID_EVENT'); }
  if (!value || typeof value !== 'object' || !('type' in value) || typeof value.type !== 'string') throw new Error('HOST_STREAM_INVALID_EVENT');
  const type = value.type;
  if (!['turn_start', 'model_step_start', 'model_delta', 'model_step_end', 'tool_start', 'tool_end', 'approval_requested', 'question_requested', 'turn_completed', 'turn_failed', 'turn_cancelled'].includes(type)) throw new Error('HOST_STREAM_UNKNOWN_EVENT');
  return value as HostTurnEvent;
}

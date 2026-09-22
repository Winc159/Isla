export class ResidentHostClient {
  constructor(private readonly baseURL: string, private readonly token: string) {}
  async health(): Promise<unknown> { return this.request('/health', false); }
  async capabilities(): Promise<unknown> { return this.request('/capabilities'); }
  async sessions(): Promise<unknown> { return this.request('/sessions'); }
  async createSession(prompt?: string): Promise<unknown> { return this.request('/sessions', true, prompt === undefined ? {} : { prompt }); }
  async prompt(sessionId: string, text: string): Promise<unknown> { return this.request(`/sessions/${encodeURIComponent(sessionId)}/prompt`, true, { text }); }
  async cancel(sessionId: string): Promise<unknown> { return this.request(`/sessions/${encodeURIComponent(sessionId)}/cancel`, true, {}); }
  async events(sessionId: string): Promise<string> { const response = await fetch(`${this.baseURL}/sessions/${encodeURIComponent(sessionId)}/events`, { headers: { authorization: `Bearer ${this.token}` } }); if (!response.ok) throw new Error(`HOST_HTTP_${response.status}`); return response.text(); }
  private async request(path: string, auth = true, body?: unknown): Promise<unknown> { const response = await fetch(`${this.baseURL}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(auth ? { authorization: `Bearer ${this.token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); if (!response.ok) throw new Error(`HOST_HTTP_${response.status}`); return response.json(); }
}

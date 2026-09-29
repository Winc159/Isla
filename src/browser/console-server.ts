import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Server } from 'node:http';
import type { BrowserRuntime } from './runtime.js';
import type { CredentialVault } from './vault.js';
import type { CredentialApprovalStore } from './credential-approval.js';

export interface BrowserConsoleServerOptions { readonly runtime: BrowserRuntime; readonly vault?: CredentialVault; readonly approvals?: CredentialApprovalStore; readonly host?: string; readonly port?: number; readonly token?: string; }

export class BrowserConsoleServer {
  readonly token: string;
  private readonly host: string;
  private readonly port: number;
  private server: Server | undefined;
  private readonly sessions = new Map<string, number>();

  constructor(private readonly options: BrowserConsoleServerOptions) {
    this.host = options.host ?? '127.0.0.1';
    if (this.host !== '127.0.0.1' && this.host !== '::1') throw new Error('BROWSER_CONSOLE_LOOPBACK_REQUIRED');
    this.port = options.port ?? 0;
    this.token = options.token ?? randomBytes(24).toString('hex');
  }

  async start(): Promise<{ readonly host: string; readonly port: number; readonly token: string }> {
    if (this.server) throw new Error('BROWSER_CONSOLE_ALREADY_STARTED');
    this.server = createServer((request, response) => { void this.handle(request, response).catch(error => { if (response.headersSent) { response.end(); return; } response.statusCode = 500; response.setHeader('content-type', 'application/json; charset=utf-8'); response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'BROWSER_CONSOLE_ERROR' })); }); });
    try { await new Promise<void>((resolve, reject) => { this.server!.once('error', reject); this.server!.listen(this.port, this.host, resolve); }); }
    catch (error) { this.server = undefined; throw error; }
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('BROWSER_CONSOLE_ADDRESS_UNAVAILABLE');
    return { host: this.host, port: address.port, token: this.token };
  }

  async close(): Promise<void> { if (!this.server) return; await new Promise<void>(resolve => this.server!.close(() => resolve())); this.server = undefined; }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('content-type', 'application/json; charset=utf-8');
    if (request.method === 'GET' && request.url === '/health') { response.end(JSON.stringify({ ok: true, ready: Boolean(this.server) })); return; }
    if (request.method === 'GET' && request.url === '/browser') { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(CONSOLE_HTML); return; }
    const bearer = this.authorized(request);
    const cookie = this.cookieAuthorized(request);
    if (!bearer && !cookie) { response.statusCode = 401; response.end(JSON.stringify({ error: 'UNAUTHORIZED' })); return; }
    if (bearer && !cookie) { const session = randomBytes(24).toString('hex'); this.sessions.set(session, Date.now() + 15 * 60_000); response.setHeader('set-cookie', `isla_browser_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=900`); response.setHeader('x-isla-csrf', session); }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const origin = request.headers.origin;
      if (origin && !origin.startsWith(`http://${this.host}:`) && origin !== `http://${this.host}`) { response.statusCode = 403; response.end(JSON.stringify({ error: 'ORIGIN_FORBIDDEN' })); return; }
      if (cookie && request.headers['x-csrf-token'] !== cookie) { response.statusCode = 403; response.end(JSON.stringify({ error: 'CSRF_REQUIRED' })); return; }
    }
    if (request.method === 'GET' && request.url === '/browser/vault/status') { response.end(JSON.stringify({ locked: this.options.vault ? this.options.vault.locked : true })); return; }
    if (request.method === 'GET' && request.url === '/browser/vault/entries') { if (!this.options.vault || this.options.vault.locked) { response.statusCode = 423; response.end(JSON.stringify({ error: 'VAULT_LOCKED' })); return; } response.end(JSON.stringify({ entries: this.options.vault.list() })); return; }
    if (request.method === 'POST' && request.url === '/browser/vault/lock') { this.options.vault?.lock(); response.end(JSON.stringify({ locked: true })); return; }
    if (request.method === 'POST' && request.url === '/browser/vault/unlock') {
      if (!this.options.vault) { response.statusCode = 404; response.end(JSON.stringify({ error: 'VAULT_UNAVAILABLE' })); return; }
      let body = ''; for await (const chunk of request) body += chunk.toString(); const value = JSON.parse(body || '{}') as { masterPassword?: unknown };
      if (typeof value.masterPassword !== 'string' || !value.masterPassword) { response.statusCode = 400; response.end(JSON.stringify({ error: 'MASTER_PASSWORD_REQUIRED' })); return; }
      try { await this.options.vault.unlock(value.masterPassword); response.end(JSON.stringify({ locked: false })); } catch { response.statusCode = 401; response.end(JSON.stringify({ error: 'VAULT_UNLOCK_FAILED' })); } return;
    }
    if (request.method === 'POST' && request.url === '/browser/approvals') {
      if (!this.options.approvals) { response.statusCode = 404; response.end(JSON.stringify({ error: 'APPROVALS_UNAVAILABLE' })); return; }
      let body = ''; for await (const chunk of request) body += chunk.toString(); const value = JSON.parse(body || '{}') as Record<string, unknown>;
      if (typeof value.origin !== 'string' || typeof value.purpose !== 'string') { response.statusCode = 400; response.end(JSON.stringify({ error: 'ORIGIN_PURPOSE_REQUIRED' })); return; }
      const input = { origin: value.origin, purpose: value.purpose, ...(typeof value.label === 'string' ? { label: value.label } : {}), ...(typeof value.usernameHint === 'string' ? { usernameHint: value.usernameHint } : {}) };
      const requestRecord = this.options.approvals.create(input); response.statusCode = 201; response.end(JSON.stringify(requestRecord)); return;
    }
    const approval = request.url?.match(/^\/browser\/approvals\/([^/]+)(?:\/(decide))?$/);
    if (approval && request.method === 'GET') { if (!this.options.approvals) { response.statusCode = 404; response.end(JSON.stringify({ error: 'APPROVALS_UNAVAILABLE' })); return; } response.end(JSON.stringify(this.options.approvals.get(approval[1]!))); return; }
    if (approval && approval[2] === 'decide' && request.method === 'POST') { if (!this.options.approvals) { response.statusCode = 404; response.end(JSON.stringify({ error: 'APPROVALS_UNAVAILABLE' })); return; } let body = ''; for await (const chunk of request) body += chunk.toString(); const value = JSON.parse(body || '{}') as { decision?: unknown }; if (value.decision !== 'y' && value.decision !== 'n' && value.decision !== 'other') { response.statusCode = 400; response.end(JSON.stringify({ error: 'DECISION_REQUIRED' })); return; } response.end(JSON.stringify(this.options.approvals.decide(approval[1]!, value.decision))); return; }
    if (request.method === 'GET' && request.url === '/browser/sessions') { response.end(JSON.stringify({ sessions: this.options.runtime.list() })); return; }
    const match = request.url?.match(/^\/browser\/sessions\/([^/]+)$/);
    if (match && request.method === 'GET') { response.end(JSON.stringify(await this.options.runtime.snapshot(match[1]!))); return; }
    const elements = request.url?.match(/^\/browser\/sessions\/([^/]+)\/elements$/);
    if (elements && request.method === 'GET') { response.end(JSON.stringify({ elements: await this.options.runtime.observe(elements[1]!) })); return; }
    const control = request.url?.match(/^\/browser\/sessions\/([^/]+)\/control\/(take|release)$/);
    if (control && request.method === 'POST') {
      if (control[2] === 'take') { await this.options.runtime.reopen(control[1]!); this.options.runtime.takeUserControl(control[1]!); } else this.options.runtime.releaseUserControl(control[1]!);
      response.end(JSON.stringify({ sessionId: control[1], control: this.options.runtime.controlState(control[1]!) })); return;
    }
    if (match && request.method === 'POST') {
      let body = ''; for await (const chunk of request) body += chunk.toString();
      const value = JSON.parse(body || '{}') as { url?: unknown };
      if (typeof value.url !== 'string') { response.statusCode = 400; response.end(JSON.stringify({ error: 'URL_REQUIRED' })); return; }
      response.end(JSON.stringify(await this.options.runtime.navigate(match[1]!, value.url))); return;
    }
    const action = request.url?.match(/^\/browser\/sessions\/([^/]+)\/(screenshot|click|type)$/);
    if (action && action[2] === 'screenshot' && request.method === 'GET') { response.setHeader('content-type', 'image/png'); response.end(await this.options.runtime.screenshot(action[1]!)); return; }
    if (action && request.method === 'POST') {
      let body = ''; for await (const chunk of request) body += chunk.toString(); const value = JSON.parse(body || '{}') as { ref?: unknown; text?: unknown };
      if (typeof value.ref !== 'string') { response.statusCode = 400; response.end(JSON.stringify({ error: 'REF_REQUIRED' })); return; }
      const snapshot = action[2] === 'click' ? await this.options.runtime.userClick(action[1]!, value.ref) : typeof value.text === 'string' ? await this.options.runtime.userType(action[1]!, value.ref, value.text) : undefined;
      if (!snapshot) { response.statusCode = 400; response.end(JSON.stringify({ error: 'TEXT_REQUIRED' })); return; } response.end(JSON.stringify(snapshot)); return;
    }
    response.statusCode = 404; response.end(JSON.stringify({ error: 'NOT_FOUND' }));
  }

  private authorized(request: IncomingMessage): boolean { const value = request.headers.authorization; if (!value?.startsWith('Bearer ')) return false; const provided = Buffer.from(value.slice(7)); const expected = Buffer.from(this.token); return provided.length === expected.length && timingSafeEqual(provided, expected); }
  private cookieAuthorized(request: IncomingMessage): string | undefined { const raw = request.headers.cookie ?? ''; const value = /(?:^|;\s*)isla_browser_session=([^;]+)/.exec(raw)?.[1]; if (!value) return undefined; const expiry = this.sessions.get(value); if (!expiry || expiry <= Date.now()) { this.sessions.delete(value); return undefined; } return value; }
}

const CONSOLE_HTML = `<!doctype html><meta charset="utf-8"><title>Isla Browser Console</title>
<style>body{font:14px system-ui;margin:24px;max-width:1100px}input{padding:6px}button{margin:4px;padding:6px 10px}.card{border:1px solid #bbb;padding:12px;margin:12px 0}.shot{display:block;max-width:100%;border:1px solid #ddd;margin:10px 0}.element{display:flex;gap:8px;align-items:center;margin:5px 0}.element input{min-width:260px}</style>
<main><h1>Isla Browser Console</h1><p id="status">需要认证后查看会话。</p><label>CLI 显示的 Token <input id="token" type="password" autocomplete="off"></label> <button id="login">认证</button> <button id="refresh">刷新</button><div id="sessions"></div></main>
<script>
let token=localStorage.getItem('isla-browser-token')||'',csrf='';const loads={};const tokenInput=document.querySelector('#token'),statusEl=document.querySelector('#status'),sessionsEl=document.querySelector('#sessions');tokenInput.value=token;
const headers=()=>{const h={Authorization:'Bearer '+token};if(csrf)h['x-csrf-token']=csrf;return h};
async function api(path,init={}){const r=await fetch(path,{...init,headers:{...headers(),...(init.headers||{})}});csrf=r.headers.get('x-isla-csrf')||csrf;if(!r.ok)throw new Error(await r.text());return r}
async function refresh(){token=tokenInput.value.trim();if(!token){statusEl.textContent='请输入 CLI 启动时显示的 token';return}try{const r=await api('/browser/sessions');const d=await r.json();statusEl.textContent='已认证并连接';localStorage.setItem('isla-browser-token',token);sessionsEl.innerHTML='';for(const s of d.sessions||[])renderSession(s)}catch(e){statusEl.textContent='认证失败：'+e.message}}
function button(text,fn,disabled=false){const b=document.createElement('button');b.textContent=text;b.disabled=disabled;b.onclick=fn;return b}
function renderSession(s){const card=document.createElement('section');card.className='card';const title=document.createElement('strong');title.textContent=s.id+' ['+s.status+']';card.append(title,button('接管',()=>control(s.id,'take'),s.status==='user_control'),button('释放控制权（再回 CLI 输入 enter）',()=>control(s.id,'release'),s.status==='agent_control'),button('刷新远程视图',()=>openPage(s.id)));const hint=document.createElement('p');hint.textContent='Windows 本机请直接在 Isla 打开的 Chromium 窗口中操作；下方远程视图用于无头或远程主机。';const view=document.createElement('div');view.id='view-'+s.id;card.append(hint,view);sessionsEl.append(card)}
async function control(id,action){try{await api('/browser/sessions/'+encodeURIComponent(id)+'/control/'+action,{method:'POST'});await refresh()}catch(e){alert(e.message)}}
async function openPage(id){const generation=(loads[id]||0)+1;loads[id]=generation;const view=document.getElementById('view-'+id);view.textContent='加载页面中…';const add=node=>{if(loads[id]===generation)view.append(node)};view.innerHTML='';try{const shot=await api('/browser/sessions/'+encodeURIComponent(id)+'/screenshot');if(loads[id]!==generation)return;const img=document.createElement('img');img.className='shot';img.src=URL.createObjectURL(await shot.blob());add(img)}catch(e){if(loads[id]!==generation)return;const warning=document.createElement('p');warning.textContent='截图暂不可用，可继续使用原生浏览器或下方控件：'+e.message;add(warning)}try{const er=await api('/browser/sessions/'+encodeURIComponent(id)+'/elements');if(loads[id]!==generation)return;const data=await er.json();for(const e of data.elements||[])add(renderElement(id,e))}catch(e){if(loads[id]!==generation)return;const warning=document.createElement('p');warning.textContent='页面正在跳转，请稍后刷新远程视图：'+e.message;add(warning)}}
function renderElement(id,e){const row=document.createElement('div');row.className='element';const label=document.createElement('span');label.textContent=(e.name||e.text||e.role||e.ref)+' ['+e.ref+']';row.append(label);if(e.role==='button'||e.role==='a'||e.role==='link')row.append(button('点击',()=>act(id,'click',e.ref)));else{const input=document.createElement('input');input.type=e.inputType==='password'||/password|密码/i.test((e.name||'')+' '+(e.text||''))?'password':'text';input.placeholder='输入后点击填写';row.append(input,button('填写',()=>act(id,'type',e.ref,input.value)))}return row}
async function act(id,action,ref,text){try{await api('/browser/sessions/'+encodeURIComponent(id)+'/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ref,...(text!==undefined?{text}:{})})});await openPage(id)}catch(e){alert(e.message)}}
login.onclick=refresh;document.querySelector('#refresh').onclick=refresh;if(token)refresh();
</script>`;

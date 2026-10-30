import type { ProfileMcpSettingsV1 } from '../config/schema.js';
import type { McpServerConfig } from './types.js';

type UnknownRecord = Record<string, unknown>;

export function parseMcpProfileSettings(name: string, value: unknown): ProfileMcpSettingsV1 {
  if (!isRecord(value)) throw new Error(`Isla profile ${name}.mcp must be an object`);
  const rawServers = value.servers === undefined ? [] : value.servers;
  if (!Array.isArray(rawServers)) throw new Error(`Isla profile ${name}.mcp.servers must be an array`);
  if (rawServers.length > 8) throw new Error(`Isla profile ${name}.mcp.servers must contain at most 8 servers`);
  const ids = new Set<string>();
  const servers = rawServers.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`Isla profile ${name}.mcp.servers[${index}] must be an object`);
    const field = (key: string) => `Isla profile ${name}.mcp.servers[${index}].${key}`;
    const id = nonEmptyString(raw.id, field('id'));
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || ids.has(id)) throw new Error(`${field('id')} is invalid or duplicated`);
    ids.add(id);
    const transport = raw.transport === undefined ? 'stdio' : raw.transport;
    if (transport !== 'stdio' && transport !== 'streamable-http') throw new Error(`${field('transport')} is unsupported`);
    const command = transport === 'stdio' ? nonEmptyString(raw.command, field('command')) : undefined;
    const args = raw.args === undefined ? [] : raw.args;
    if (!Array.isArray(args) || args.length > 64 || args.some(item => typeof item !== 'string')) throw new Error(`${field('args')} must be an array of at most 64 strings`);
    const url = transport === 'streamable-http' ? nonEmptyString(raw.url, field('url')) : undefined;
    if (url) {
      let parsed: URL;
      try { parsed = new URL(url); } catch { throw new Error(`${field('url')} must be an absolute URL`); }
      const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]' || parsed.hostname === '::1';
      if (parsed.username || parsed.password || parsed.hash || (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback))) throw new Error(`${field('url')} must use HTTPS (HTTP is allowed only on loopback)`);
    }
    let oauth: McpServerConfig['oauth'];
    if (raw.oauth !== undefined) {
      if (transport !== 'streamable-http' || !isRecord(raw.oauth)) throw new Error(`${field('oauth')} is only valid for streamable-http`);
      const callbackBaseUrl = nonEmptyString(raw.oauth.callbackBaseUrl, `${field('oauth')}.callbackBaseUrl`);
      let callback: URL;
      try { callback = new URL(callbackBaseUrl); } catch { throw new Error(`${field('oauth')}.callbackBaseUrl must be an absolute URL`); }
      const loopback = callback.hostname === 'localhost' || callback.hostname === '127.0.0.1' || callback.hostname === '[::1]' || callback.hostname === '::1';
      if (callback.username || callback.password || callback.search || callback.hash || (callback.protocol !== 'https:' && !(callback.protocol === 'http:' && loopback))) throw new Error(`${field('oauth')}.callbackBaseUrl must use HTTPS (HTTP is allowed only on loopback)`);
      oauth = { callbackBaseUrl: callbackBaseUrl.replace(/\/+$/u, '') };
    }
    const headersValue = raw.headers === undefined ? {} : raw.headers;
    if (!isRecord(headersValue) || Object.keys(headersValue).length > 16 || Object.entries(headersValue).some(([key, item]) => !/^[A-Za-z0-9-]{1,64}$/.test(key) || typeof item !== 'string' || item.length > 4096 || /(authorization|cookie|host|content-length|key|token|secret|password|credential)/i.test(key))) throw new Error(`${field('headers')} is invalid`);
    const cwd = raw.cwd === undefined || raw.cwd === 'workspace' ? raw.cwd : nonEmptyString(raw.cwd, field('cwd'));
    const envValue = raw.env === undefined ? {} : raw.env;
    if (!isRecord(envValue) || Object.entries(envValue).some(([key, item]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof item !== 'string')) throw new Error(`${field('env')} must be a string map`);
    const bounded = (key: 'startupTimeoutMs' | 'callTimeoutMs', fallback: number): number => raw[key] === undefined ? fallback : (!Number.isInteger(raw[key]) || (raw[key] as number) < 1 || (raw[key] as number) > 120_000) ? (() => { throw new Error(`${field(key)} is invalid`); })() : raw[key] as number;
    if (transport === 'stdio' && (raw.url !== undefined || raw.headers !== undefined)) throw new Error(`${field('url')} and headers are only valid for streamable-http`);
    if (transport === 'streamable-http' && (raw.command !== undefined || args.length || cwd || Object.keys(envValue as object).length)) throw new Error(`${field('command')} and stdio options are only valid for stdio`);
    return Object.freeze({ id, transport, ...(command ? { command } : {}), ...(transport === 'stdio' ? { args: Object.freeze([...args as string[]]) } : {}), ...(url ? { url } : {}), ...(oauth ? { oauth: Object.freeze(oauth) } : {}), ...(Object.keys(headersValue).length ? { headers: Object.freeze({ ...(headersValue as Record<string, string>) }) } : {}), ...(cwd ? { cwd } : {}), required: raw.required === undefined ? false : booleanValue(raw.required, field('required')), startupTimeoutMs: bounded('startupTimeoutMs', 10_000), callTimeoutMs: bounded('callTimeoutMs', 60_000), env: Object.freeze({ ...(envValue as Record<string, string>) }) });
  });
  return Object.freeze({ servers: Object.freeze(servers) });
}

function isRecord(value: unknown): value is UnknownRecord { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function nonEmptyString(value: unknown, field: string): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`); return value.trim(); }
function booleanValue(value: unknown, field: string): boolean { if (typeof value !== 'boolean') throw new Error(`${field} must be boolean`); return value; }

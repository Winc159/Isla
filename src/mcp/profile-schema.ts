import type { ProfileMcpSettingsV1 } from '../config.js';

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
    if (transport !== 'stdio') throw new Error(`${field('transport')} must be stdio`);
    const command = nonEmptyString(raw.command, field('command'));
    const args = raw.args === undefined ? [] : raw.args;
    if (!Array.isArray(args) || args.some(item => typeof item !== 'string')) throw new Error(`${field('args')} must be an array of strings`);
    const cwd = raw.cwd === undefined || raw.cwd === 'workspace' ? raw.cwd : nonEmptyString(raw.cwd, field('cwd'));
    const envValue = raw.env === undefined ? {} : raw.env;
    if (!isRecord(envValue) || Object.entries(envValue).some(([key, item]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof item !== 'string')) throw new Error(`${field('env')} must be a string map`);
    const bounded = (key: 'startupTimeoutMs' | 'callTimeoutMs', fallback: number): number => raw[key] === undefined ? fallback : (!Number.isInteger(raw[key]) || (raw[key] as number) < 1 || (raw[key] as number) > 120_000) ? (() => { throw new Error(`${field(key)} is invalid`); })() : raw[key] as number;
    return Object.freeze({ id, transport: 'stdio' as const, command, args: Object.freeze([...args as string[]]), ...(cwd ? { cwd } : {}), required: raw.required === undefined ? false : booleanValue(raw.required, field('required')), startupTimeoutMs: bounded('startupTimeoutMs', 10_000), callTimeoutMs: bounded('callTimeoutMs', 60_000), env: Object.freeze({ ...(envValue as Record<string, string>) }) });
  });
  return Object.freeze({ servers: Object.freeze(servers) });
}

function isRecord(value: unknown): value is UnknownRecord { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function nonEmptyString(value: unknown, field: string): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`); return value.trim(); }
function booleanValue(value: unknown, field: string): boolean { if (typeof value !== 'boolean') throw new Error(`${field} must be boolean`); return value; }

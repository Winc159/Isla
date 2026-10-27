import type { ToolPermission } from './types.js';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type PolicyEffect = 'allow' | 'deny' | 'ask';
export interface PolicyRuleV1 {
  readonly id: string;
  readonly effect: PolicyEffect;
  readonly permission?: ToolPermission['kind'];
  readonly tool?: string;
  readonly workspace?: string;
  readonly commandPrefix?: readonly string[];
  readonly networkHost?: string;
  readonly expiresAt?: string;
}
export interface PolicyRequestV1 {
  readonly permission: ToolPermission;
  readonly tool: string;
  readonly workspace: string;
  readonly argv?: readonly string[];
  readonly networkHost?: string;
  readonly now?: number;
}
export interface PolicyDecisionV1 { readonly effect: PolicyEffect; readonly ruleId?: string; }

export class FilePolicyStore {
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly path: string) {}
  async list(): Promise<readonly PolicyRuleV1[]> { return readRules(this.path); }
  async put(rule: PolicyRuleV1): Promise<void> {
    validateRule(rule);
    await this.mutate(async rules => [...rules.filter(item => item.id !== rule.id), rule]);
  }
  async revoke(id: string): Promise<boolean> {
    let removed = false;
    await this.mutate(async rules => { const next = rules.filter(rule => rule.id !== id); removed = next.length !== rules.length; return next; });
    return removed;
  }
  private async mutate(update: (rules: readonly PolicyRuleV1[]) => Promise<readonly PolicyRuleV1[]>): Promise<void> {
    const operation = this.pending.then(async () => {
      const rules = await update(await readRules(this.path));
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify({ version: 1, rules }, null, 2)}\n`, 'utf8');
      await rename(temporary, this.path);
    });
    this.pending = operation.catch(() => undefined);
    await operation;
  }
}

async function readRules(path: string): Promise<readonly PolicyRuleV1[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || (parsed as Record<string, unknown>).version !== 1 || !Array.isArray((parsed as Record<string, unknown>).rules)) throw new Error('APPROVAL_RULES_INVALID');
    const rules = (parsed as { rules: unknown[] }).rules;
    if (!rules.every(isPolicyRule)) throw new Error('APPROVAL_RULES_INVALID');
    return rules;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
function isPolicyRule(value: unknown): value is PolicyRuleV1 {
  if (!value || typeof value !== 'object') return false;
  const rule = value as Record<string, unknown>;
  return typeof rule.id === 'string' && ['allow', 'deny', 'ask'].includes(String(rule.effect))
    && (rule.permission === undefined || ['none', 'filesystem-read', 'filesystem-write', 'command-execute', 'process-interact', 'network', 'network-download', 'dependency-install', 'mcp-invoke', 'credential-use', 'sandbox-elevate'].includes(String(rule.permission)))
    && (rule.tool === undefined || typeof rule.tool === 'string') && (rule.workspace === undefined || typeof rule.workspace === 'string')
    && (rule.commandPrefix === undefined || Array.isArray(rule.commandPrefix) && rule.commandPrefix.every(part => typeof part === 'string'))
    && (rule.networkHost === undefined || typeof rule.networkHost === 'string' && isNormalizedNetworkHost(rule.networkHost))
    && (rule.expiresAt === undefined || typeof rule.expiresAt === 'string' && Number.isFinite(Date.parse(rule.expiresAt)));
}
function validateRule(rule: PolicyRuleV1): void { if (!isPolicyRule(rule) || !rule.id.trim() || rule.id.length > 128) throw new Error('APPROVAL_RULE_INVALID'); }
function isNormalizedNetworkHost(value: string): boolean { try { return normalizeNetworkHost(value) === value; } catch { return false; } }

export function evaluatePolicy(rules: readonly PolicyRuleV1[], request: PolicyRequestV1): PolicyDecisionV1 {
  const candidates = rules.filter(rule => !rule.expiresAt || Date.parse(rule.expiresAt) > (request.now ?? Date.now()))
    .filter(rule => rule.permission === undefined || rule.permission === request.permission.kind)
    .filter(rule => rule.tool === undefined || rule.tool === request.tool)
    .filter(rule => rule.workspace === undefined || normalizePath(rule.workspace) === normalizePath(request.workspace))
    .filter(rule => rule.commandPrefix === undefined || startsWithArgv(request.argv ?? [], rule.commandPrefix))
    .filter(rule => rule.networkHost === undefined || (request.networkHost !== undefined && normalizeNetworkHost(rule.networkHost) === normalizeNetworkHost(request.networkHost)));
  const matched = candidates.find(rule => rule.effect === 'deny') ?? candidates.find(rule => rule.effect === 'allow') ?? candidates[0];
  return matched ? { effect: matched.effect, ruleId: matched.id } : { effect: 'ask' };
}

function startsWithArgv(argv: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length > 0 && argv.length >= prefix.length && prefix.every((part, index) => argv[index] === part);
}
function normalizePath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/\/+$/u, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function normalizeNetworkHost(value: string): string {
  if (!value || value.length > 253 || /[\s/@?#\\]/u.test(value)) throw new Error('APPROVAL_NETWORK_HOST_INVALID');
  try {
    const parsed = new URL(`https://${value}`);
    if (parsed.username || parsed.password || parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.host !== value.toLowerCase()) throw new Error();
    const host = parsed.hostname.toLowerCase().replace(/\.$/u, '');
    if (!host || host.length > 253) throw new Error();
    return host;
  } catch { throw new Error('APPROVAL_NETWORK_HOST_INVALID'); }
}

import type { ToolCapability } from './tools/types.js';
import type { CapabilityPolicy } from './capabilities.js';

export type CapabilityId = string;
export type CapabilityRisk = 'read' | 'workspace-write' | 'external-side-effect' | 'secret';
export type CapabilityAvailabilityState = 'available' | 'unavailable' | 'denied' | 'needs-config';

export interface CapabilityToolSummary {
  readonly name: string;
  readonly description: string;
}

export interface CapabilityRequirements {
  readonly toolCalling?: true;
  readonly platforms?: readonly NodeJS.Platform[];
  readonly configKeys?: readonly string[];
}

export interface CapabilityManifest {
  readonly id: CapabilityId;
  readonly version: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly toolSummaries: readonly CapabilityToolSummary[];
  readonly activation: 'eager' | 'lazy';
  readonly lifetime: 'host' | 'session' | 'task';
  readonly requirements: CapabilityRequirements;
  readonly risk: CapabilityRisk;
}

export interface CapabilityAvailability {
  readonly state: CapabilityAvailabilityState;
  readonly reasonCode?: string;
}

export interface CapabilityStatusContext {
  readonly providerId: string;
  readonly toolCalling?: boolean;
  readonly platform?: NodeJS.Platform;
}

export interface CapabilityActivationContext extends CapabilityStatusContext {
  readonly signal?: AbortSignal;
}

export interface CapabilityProvider {
  readonly manifest: CapabilityManifest;
  status(context: CapabilityStatusContext): CapabilityAvailability;
  activate(context: CapabilityActivationContext): Promise<ToolCapability>;
}

export interface CapabilityCatalogEntry {
  readonly manifest: CapabilityManifest;
  readonly availability: CapabilityAvailability;
}

export interface CapabilityCatalogSearchResult extends CapabilityCatalogEntry {
  readonly score: number;
}

const MAX_MANIFEST_DESCRIPTION_CHARS = 512;
const MAX_KEYWORDS = 32;
const MAX_KEYWORD_CHARS = 64;
const MAX_TOOL_SUMMARIES = 64;
const MAX_TOOL_SUMMARY_CHARS = 256;
const MAX_SEARCH_RESULTS = 32;

export class CapabilityCatalog {
  private readonly providers = new Map<CapabilityId, CapabilityProvider>();

  register(provider: CapabilityProvider): void {
    validateManifest(provider.manifest);
    if (this.providers.has(provider.manifest.id)) throw new Error('CAPABILITY_DUPLICATE_ID');
    this.providers.set(provider.manifest.id, provider);
  }

  has(id: CapabilityId): boolean {
    return this.providers.has(id);
  }

  get(id: CapabilityId): CapabilityCatalogEntry | undefined {
    const provider = this.providers.get(id);
    if (!provider) return undefined;
    return Object.freeze({ manifest: provider.manifest, availability: provider.status({ providerId: id }) });
  }

  list(): readonly CapabilityCatalogEntry[] {
    return [...this.providers.keys()].sort().flatMap(id => {
      const entry = this.get(id);
      return entry ? [entry] : [];
    });
  }

  search(query: string, limit = 8): readonly CapabilityCatalogSearchResult[] {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return [];
    if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_SEARCH_RESULTS) throw new Error('CAPABILITY_SEARCH_LIMIT_INVALID');
    const terms = tokenizeQuery(normalizedQuery);
    const minimumScore = /^[\u4e00-\u9fff]+$/u.test(normalizedQuery) ? 2 : 1;
    return this.list()
      .map(entry => ({ ...entry, score: scoreManifest(entry.manifest, terms) }))
      .filter(entry => entry.score >= minimumScore)
      .sort((left, right) => right.score - left.score || left.manifest.id.localeCompare(right.manifest.id))
      .slice(0, limit)
      .map(entry => Object.freeze(entry));
  }

  provider(id: CapabilityId): CapabilityProvider | undefined {
    return this.providers.get(id);
  }
}

export interface CapabilityProviderOptions {
  readonly id?: CapabilityId;
  readonly version?: string;
  readonly keywords?: readonly string[];
  readonly activation?: 'eager' | 'lazy';
  readonly lifetime?: 'host' | 'session' | 'task';
  readonly risk?: CapabilityRisk;
  readonly requirements?: CapabilityRequirements;
  readonly policy?: CapabilityPolicy;
  readonly toolCalling?: boolean;
}

export function createCapabilityProvider(capability: ToolCapability, options: CapabilityProviderOptions = {}): CapabilityProvider {
  const id = options.id ?? builtinCapabilityId(capability.id);
  const filteredTools = capability.tools.filter(tool => toolAllowed(capability.id, tool.definition.name, options.policy));
  const summaryTools = capability.id.startsWith('mcp:') ? capability.tools.filter(tool => toolAllowedByToolPolicy(tool.definition.name, options.policy)) : capability.tools;
  const manifest: CapabilityManifest = {
    id,
    version: options.version ?? '1.0.0',
    description: capability.instructions.slice(0, MAX_MANIFEST_DESCRIPTION_CHARS),
    keywords: (options.keywords ?? [id.replace(/^builtin\./u, ''), ...capability.tools.map(tool => tool.definition.name)])
      .map(keyword => keyword.slice(0, MAX_KEYWORD_CHARS))
      .slice(0, MAX_KEYWORDS),
    toolSummaries: summaryTools.slice(0, MAX_TOOL_SUMMARIES).map(tool => ({ name: tool.definition.name, description: tool.definition.description.slice(0, MAX_TOOL_SUMMARY_CHARS) })),
    activation: options.activation ?? 'lazy',
    lifetime: options.lifetime ?? 'task',
    requirements: options.requirements ?? {},
    risk: options.risk ?? 'read',
  };
  validateManifest(manifest);
  return {
    manifest,
    status: context => filteredTools.length ? availabilityFor(capability.id, context, options) : { state: 'denied', reasonCode: 'CAPABILITY_DENIED' },
    activate: async () => ({ ...capability, tools: filteredTools }),
  };
}

function validateManifest(manifest: CapabilityManifest): void {
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(manifest.id)) throw new Error('CAPABILITY_MANIFEST_INVALID_ID');
  if (!manifest.version.trim() || !manifest.description.trim() || manifest.description.length > MAX_MANIFEST_DESCRIPTION_CHARS) throw new Error('CAPABILITY_MANIFEST_INVALID_DESCRIPTION');
  if (manifest.keywords.length > MAX_KEYWORDS || manifest.keywords.some(keyword => !keyword.trim() || keyword.length > MAX_KEYWORD_CHARS)) throw new Error('CAPABILITY_MANIFEST_INVALID_KEYWORDS');
  const toolNames = new Set<string>();
  if (manifest.toolSummaries.length > MAX_TOOL_SUMMARIES || manifest.toolSummaries.some(tool => {
    if (!tool.name.trim() || !tool.description.trim() || tool.description.length > MAX_TOOL_SUMMARY_CHARS || toolNames.has(tool.name)) return true;
    toolNames.add(tool.name);
    return false;
  })) throw new Error('CAPABILITY_MANIFEST_INVALID_TOOLS');
}

function scoreManifest(manifest: CapabilityManifest, terms: readonly string[]): number {
  const fields = [manifest.id, manifest.description, ...manifest.keywords, ...manifest.toolSummaries.flatMap(tool => [tool.name, tool.description])].map(value => value.toLowerCase());
  return terms.reduce((score, term) => score + (fields.some(field => field.includes(term)) ? 1 : 0), 0);
}

function tokenizeQuery(query: string): readonly string[] {
  const words = query.split(/\s+/u).filter(Boolean);
  if (/^[\u4e00-\u9fff]+$/u.test(query) && query.length > 2) {
    return [query, ...Array.from({ length: query.length - 1 }, (_, index) => query.slice(index, index + 2))];
  }
  return words;
}

function builtinCapabilityId(id: string): CapabilityId {
  if (id.startsWith('mcp:')) return `mcp.${id.slice(4)}`;
  const normalized = id.replace(/[^a-z0-9._-]+/giu, '-').replace(/-+/gu, '-').replace(/^-|-$/gu, '');
  return `builtin.${normalized || 'unnamed'}`;
}

function availabilityFor(id: string, context: CapabilityStatusContext, options: CapabilityProviderOptions): CapabilityAvailability {
  if (options.requirements?.toolCalling && context.toolCalling === false) return { state: 'unavailable', reasonCode: 'CAPABILITY_REQUIRES_TOOL_CALLING' };
  if (options.requirements?.platforms && context.platform && !options.requirements.platforms.includes(context.platform)) return { state: 'unavailable', reasonCode: 'CAPABILITY_PLATFORM_UNSUPPORTED' };
  if (id.startsWith('mcp:')) {
    const server = id.slice(4);
    if (options.policy?.mcpServerDeny?.includes(server) || (options.policy?.mcpServerAllow && !options.policy.mcpServerAllow.includes(server))) return { state: 'denied', reasonCode: 'CAPABILITY_DENIED' };
  }
  return { state: 'available' };
}

function toolAllowed(capabilityId: string, toolName: string, policy?: CapabilityPolicy): boolean {
  if (!policy || !capabilityId.startsWith('mcp:')) return true;
  const server = capabilityId.slice(4);
  if (policy.mcpServerDeny?.includes(server) || policy.mcpToolDeny?.includes(toolName)) return false;
  if (policy.mcpServerAllow && !policy.mcpServerAllow.includes(server)) return false;
  return !policy.mcpToolAllow || policy.mcpToolAllow.includes(toolName);
}

function toolAllowedByToolPolicy(toolName: string, policy?: CapabilityPolicy): boolean {
  if (!policy) return true;
  if (policy.mcpToolDeny?.includes(toolName)) return false;
  return !policy.mcpToolAllow || policy.mcpToolAllow.includes(toolName);
}

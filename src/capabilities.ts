import type { ToolDefinition } from './core/types.js';
import type { ToolCapability } from './tools/types.js';
import type { SkillCatalogEntry } from './skills/types.js';

export type CapabilityKind = 'builtin-tool' | 'skill' | 'mcp-tool';

export interface CapabilityInventoryEntry {
  readonly id: string;
  readonly kind: CapabilityKind;
  readonly origin: string;
  readonly available: boolean;
  readonly modelVisible: boolean;
  readonly userInvocable: boolean;
  readonly permission?: string;
  readonly schemaBytes?: number;
  readonly descriptionChars?: number;
  readonly diagnosticCode?: string;
}

export interface CapabilityPolicy {
  readonly skillAllow?: readonly string[];
  readonly skillDeny?: readonly string[];
  readonly mcpServerAllow?: readonly string[];
  readonly mcpServerDeny?: readonly string[];
  readonly mcpToolAllow?: readonly string[];
  readonly mcpToolDeny?: readonly string[];
  readonly maxTools?: number;
  readonly maxSchemaBytes?: number;
  readonly maxSkillDescriptionChars?: number;
  readonly maxSkillCatalogChars?: number;
}

export interface CapabilitySnapshot {
  readonly version: 1;
  readonly entries: readonly CapabilityInventoryEntry[];
  readonly toolDefinitions: readonly ToolDefinition[];
  readonly hash: string;
}

export function composeCapabilitySnapshot(capabilities: readonly ToolCapability[], skills: readonly SkillCatalogEntry[] = [], policy: CapabilityPolicy = {}): CapabilitySnapshot {
  const entries: CapabilityInventoryEntry[] = [];
  const toolDefinitions: ToolDefinition[] = [];
  let skillChars = 0;
  for (const capability of capabilities) {
    const kind: CapabilityKind = capability.id.startsWith('mcp:') ? 'mcp-tool' : 'builtin-tool';
    const server = kind === 'mcp-tool' ? capability.id.slice(4) : undefined;
    for (const tool of capability.tools) {
      const id = tool.definition.name;
      const allowed = kind === 'mcp-tool' ? mcpAllowed(id, server!, policy) : true;
      const definition = tool.definition;
      entries.push({ id, kind, origin: capability.id, available: true, modelVisible: allowed, userInvocable: true, ...(tool.permission ? { permission: tool.permission.kind } : {}), schemaBytes: Buffer.byteLength(JSON.stringify(definition.parameters), 'utf8') });
      if (allowed) toolDefinitions.push(definition);
    }
  }
  for (const skill of skills) {
    const allowed = skillAllowed(skill.name, policy);
    const descriptionChars = skill.description.length;
    const withinDescription = policy.maxSkillDescriptionChars === undefined || descriptionChars <= policy.maxSkillDescriptionChars;
    const withinCatalog = policy.maxSkillCatalogChars === undefined || skillChars + descriptionChars <= policy.maxSkillCatalogChars;
    const visible = allowed && skill.modelInvocable && withinDescription && withinCatalog;
    if (visible) skillChars += descriptionChars;
    entries.push({ id: `skill:${skill.name}`, kind: 'skill', origin: skill.source, available: true, modelVisible: visible, userInvocable: skill.userInvocable, descriptionChars, ...(visible ? {} : { diagnosticCode: allowed ? 'CAPABILITY_BUDGET_EXCEEDED' : 'CAPABILITY_DENIED' }) });
  }
  const visibleTools = entries.filter(entry => entry.modelVisible && entry.kind !== 'skill');
  if (policy.maxSchemaBytes !== undefined) {
    let bytes = 0;
    const allowed = new Set<string>();
    for (const tool of toolDefinitions) {
      const size = Buffer.byteLength(JSON.stringify(tool.parameters), 'utf8');
      if (bytes + size <= policy.maxSchemaBytes) { bytes += size; allowed.add(tool.name); }
    }
    for (let index = 0; index < entries.length; index += 1) if (entries[index]!.kind !== 'skill' && entries[index]!.modelVisible && !allowed.has(entries[index]!.id)) entries[index] = { ...entries[index]!, modelVisible: false, diagnosticCode: 'CAPABILITY_BUDGET_EXCEEDED' };
    for (let index = toolDefinitions.length - 1; index >= 0; index -= 1) if (!allowed.has(toolDefinitions[index]!.name)) toolDefinitions.splice(index, 1);
  }
  if (policy.maxTools !== undefined && visibleTools.length > policy.maxTools) {
    const keep = new Set(visibleTools.slice(0, policy.maxTools).map(entry => entry.id));
    for (let index = 0; index < entries.length; index += 1) if (entries[index]!.kind !== 'skill' && entries[index]!.modelVisible && !keep.has(entries[index]!.id)) entries[index] = { ...entries[index]!, modelVisible: false, diagnosticCode: 'CAPABILITY_BUDGET_EXCEEDED' };
    toolDefinitions.splice(policy.maxTools);
  }
  const canonical = JSON.stringify({ entries, tools: toolDefinitions.map(tool => tool.name) });
  return Object.freeze({ version: 1, entries: Object.freeze(entries), toolDefinitions: Object.freeze(toolDefinitions), hash: simpleHash(canonical) });
}

function skillAllowed(name: string, policy: CapabilityPolicy): boolean {
  if (policy.skillDeny?.includes(name)) return false;
  return !policy.skillAllow || policy.skillAllow.includes(name);
}

function mcpAllowed(tool: string, server: string, policy: CapabilityPolicy): boolean {
  if (policy.mcpServerDeny?.includes(server) || policy.mcpToolDeny?.includes(tool)) return false;
  if (policy.mcpServerAllow && !policy.mcpServerAllow.includes(server)) return false;
  return !policy.mcpToolAllow || policy.mcpToolAllow.includes(tool);
}

function simpleHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

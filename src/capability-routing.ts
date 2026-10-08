import type { ToolCapability, Tool } from './tools/types.js';
import { CapabilityCatalog, type CapabilityAvailabilityState, type CapabilityCatalogEntry, type CapabilityId } from './capability-catalog.js';

export interface ActivatedCapability {
  readonly id: CapabilityId;
  readonly activatedAtTurn: number;
  readonly reason: 'runtime' | 'model' | 'user';
  readonly lastUsedAtTurn: number;
}

export interface CapabilityActivationStateV1 {
  readonly version: 1;
  readonly task: readonly ActivatedCapability[];
}

export interface CapabilityActivationResult {
  readonly state: CapabilityActivationStateV1;
  readonly capability: ToolCapability;
  readonly alreadyActive: boolean;
}

export class CapabilityActivator {
  constructor(private readonly catalog: CapabilityCatalog, private state: CapabilityActivationStateV1 = { version: 1, task: [] }) {}

  get snapshot(): CapabilityActivationStateV1 {
    return Object.freeze({ version: 1, task: Object.freeze([...this.state.task]) });
  }

  isActive(id: CapabilityId): boolean {
    return this.state.task.some(item => item.id === id);
  }

  reset(): void {
    this.state = { version: 1, task: [] };
  }

  async activate(id: CapabilityId, turn: number, reason: ActivatedCapability['reason'] = 'runtime', signal?: AbortSignal): Promise<CapabilityActivationResult> {
    const entry = this.catalog.get(id);
    if (!entry) throw new Error('CAPABILITY_UNKNOWN');
    if (entry.availability.state !== 'available') throw new Error(entry.availability.reasonCode ?? `CAPABILITY_${entry.availability.state.toUpperCase()}`);
    const provider = this.catalog.provider(id);
    if (!provider) throw new Error('CAPABILITY_UNKNOWN');
    const alreadyActive = this.isActive(id);
    const capability = await provider.activate({ providerId: id, ...(signal ? { signal } : {}) });
    if (!alreadyActive) this.state = { version: 1, task: [...this.state.task, { id, activatedAtTurn: turn, lastUsedAtTurn: turn, reason }] };
    else this.state = { version: 1, task: this.state.task.map(item => item.id === id ? { ...item, lastUsedAtTurn: turn } : item) };
    return { state: this.snapshot, capability, alreadyActive };
  }
}

export interface CapabilityResolution {
  readonly selected: readonly CapabilityId[];
  readonly rejected: readonly { readonly id: CapabilityId; readonly reasonCode: string }[];
}

export function resolveCapabilities(catalog: CapabilityCatalog, activator: CapabilityActivator, input: string, alwaysInclude: readonly CapabilityId[] = []): CapabilityResolution {
  const selected = new Set<CapabilityId>(alwaysInclude);
  const rejected: { id: CapabilityId; reasonCode: string }[] = [];
  for (const item of activator.snapshot.task) selected.add(item.id);
  const untrustedInstruction = /(网页内容|页面说|页面要求|忽略策略|忽略之前|ignore (?:all )?previous|prompt injection)/iu.test(input);
  for (const result of catalog.search(input, 32)) {
    if (result.availability.state === 'available' && !(untrustedInstruction && result.manifest.risk !== 'read')) selected.add(result.manifest.id);
    else if (untrustedInstruction && result.manifest.risk !== 'read') rejected.push({ id: result.manifest.id, reasonCode: 'CAPABILITY_UNTRUSTED_CONTENT' });
    else rejected.push({ id: result.manifest.id, reasonCode: result.availability.reasonCode ?? `CAPABILITY_${result.availability.state.toUpperCase()}` });
  }
  return { selected: [...selected].sort(), rejected };
}

export interface CapabilityStepSnapshot {
  readonly version: 1;
  readonly step: number;
  readonly capabilityIds: readonly CapabilityId[];
  readonly capabilities: readonly ToolCapability[];
  readonly toolDefinitions: readonly import('./core/types.js').ToolDefinition[];
  readonly hash: string;
}

export async function composeCapabilityStepSnapshot(catalog: CapabilityCatalog, activator: CapabilityActivator, input: string, step: number, alwaysInclude: readonly CapabilityId[] = [], signal?: AbortSignal): Promise<CapabilityStepSnapshot> {
  const resolution = resolveCapabilities(catalog, activator, input, alwaysInclude);
  const capabilities: ToolCapability[] = [];
  for (const id of resolution.selected) {
    const activation = await activator.activate(id, step, 'runtime', signal);
    capabilities.push(activation.capability);
  }
  const toolDefinitions = capabilities.flatMap(capability => capability.tools.map(tool => tool.definition));
  const canonical = JSON.stringify({ step, capabilityIds: resolution.selected, tools: toolDefinitions.map(tool => tool.name) });
  return Object.freeze({ version: 1, step, capabilityIds: Object.freeze([...resolution.selected]), capabilities: Object.freeze(capabilities), toolDefinitions: Object.freeze(toolDefinitions), hash: simpleHash(canonical) });
}

export function createCapabilityRoutingTools(catalog: CapabilityCatalog, activator: CapabilityActivator, getTurn: () => number): readonly Tool[] {
  const search: Tool = {
    definition: { name: 'capability_search', description: '搜索当前可发现的能力摘要；搜索不会自动激活能力。', parameters: { type: 'object', properties: { query: { type: 'string', minLength: 1 }, limit: { type: 'integer', minimum: 1, maximum: 32 } }, required: ['query'], additionalProperties: false } },
    async execute(raw) {
      const args = parseObject(raw);
      const query = stringArg(args, 'query');
      const limit = args.limit === undefined ? 8 : integerArg(args, 'limit');
      return JSON.stringify(catalog.search(query, limit).map(publicEntry));
    },
  };
  const activate: Tool = {
    definition: { name: 'capability_activate', description: '激活一个已知能力；成功后下一 Model Step 才会暴露其工具。激活不等于批准工具调用。', parameters: { type: 'object', properties: { id: { type: 'string', minLength: 1 } }, required: ['id'], additionalProperties: false } },
    async execute(raw, options) {
      const id = stringArg(parseObject(raw), 'id');
      const result = await activator.activate(id, getTurn(), 'model', options?.signal);
      return JSON.stringify({ id, activated: true, alreadyActive: result.alreadyActive, effective: 'next_model_step' });
    },
  };
  const status: Tool = {
    definition: { name: 'capability_status', description: '查看能力的安全状态、激活状态和不可用原因。', parameters: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false } },
    async execute(raw) {
      const args = parseObject(raw);
      const entries = args.id === undefined ? catalog.list() : [catalog.get(stringArg(args, 'id'))].filter((entry): entry is CapabilityCatalogEntry => Boolean(entry));
      return JSON.stringify(entries.map(entry => ({ id: entry.manifest.id, description: entry.manifest.description, state: activator.isActive(entry.manifest.id) ? 'active' : entry.availability.state, ...(entry.availability.reasonCode ? { reasonCode: entry.availability.reasonCode } : {}) })));
    },
  };
  return [search, activate, status];
}

function publicEntry(entry: { manifest: { id: string; description: string; risk: string }; availability: { state: CapabilityAvailabilityState }; score: number }): object {
  return { id: entry.manifest.id, description: entry.manifest.description, risk: entry.manifest.risk, state: entry.availability.state, score: entry.score };
}

function parseObject(raw: string): Record<string, unknown> {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CAPABILITY_ARGUMENTS_INVALID');
  return value as Record<string, unknown>;
}

function stringArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error('CAPABILITY_ARGUMENTS_INVALID');
  return value;
}

function integerArg(args: Record<string, unknown>, name: string): number {
  const value = args[name];
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 32) throw new Error('CAPABILITY_ARGUMENTS_INVALID');
  return value as number;
}

function simpleHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

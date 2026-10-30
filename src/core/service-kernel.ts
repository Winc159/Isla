export interface Effect { close(): void | Promise<void> }

export interface ServiceKey<T> { readonly id: string; readonly _type?: T }
export function serviceKey<T>(id: string): ServiceKey<T> {
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(id)) throw new Error("SERVICE_KEY_INVALID");
  return Object.freeze({ id });
}

export type ScopeKind = "host" | "session" | "agent" | "turn" | "task";

export class RuntimeScope implements Effect {
  private readonly effects: Effect[] = [];
  private closed = false;
  constructor(readonly kind: ScopeKind, readonly id: string, readonly parent?: RuntimeScope) {
    if (!id.trim()) throw new Error("SCOPE_ID_REQUIRED");
    parent?.own(this);
  }
  child(kind: ScopeKind, id: string): RuntimeScope { this.assertOpen(); return new RuntimeScope(kind, id, this); }
  own<T extends Effect>(effect: T): T { this.assertOpen(); this.effects.push(effect); return effect; }
  defer(cleanup: () => void | Promise<void>): Effect { return this.own({ close: cleanup }); }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const errors: unknown[] = [];
    for (const effect of [...this.effects].reverse()) try { await effect.close(); } catch (error) { errors.push(error); }
    this.effects.length = 0;
    if (errors.length) throw new AggregateError(errors, `SCOPE_CLOSE_FAILED:${this.kind}:${this.id}`);
  }
  private assertOpen(): void { if (this.closed) throw new Error("SCOPE_CLOSED"); }
}

export interface ServiceContext {
  readonly scope: RuntimeScope;
  get<T>(key: ServiceKey<T>): T;
  optional<T>(key: ServiceKey<T>): T | undefined;
}
export interface ServiceDescriptor<T> {
  readonly key: ServiceKey<T>;
  readonly scope?: ScopeKind;
  readonly required?: readonly ServiceKey<unknown>[];
  readonly optional?: readonly ServiceKey<unknown>[];
  start(context: ServiceContext): T | Promise<T>;
  stop?(service: T): void | Promise<void>;
}

export class ServiceRegistry implements Effect {
  private readonly descriptors = new Map<string, ServiceDescriptor<unknown>>();
  private readonly services = new Map<string, unknown>();
  private readonly order: string[] = [];
  private readonly scope = new RuntimeScope("host", "services");
  private readonly serviceScopes = new Map<string, RuntimeScope>();
  private started = false;
  register<T>(descriptor: ServiceDescriptor<T>): void {
    if (this.started) throw new Error("SERVICE_REGISTRY_ALREADY_STARTED");
    if (this.descriptors.has(descriptor.key.id)) throw new Error(`SERVICE_DUPLICATE:${descriptor.key.id}`);
    this.descriptors.set(descriptor.key.id, descriptor as ServiceDescriptor<unknown>);
  }
  async start(): Promise<void> {
    if (this.started) return;
    const visiting = new Set<string>();
    const visit = async (id: string): Promise<void> => {
      if (this.services.has(id)) return;
      if (visiting.has(id)) throw new Error(`SERVICE_DEPENDENCY_CYCLE:${id}`);
      const descriptor = this.descriptors.get(id);
      if (!descriptor) throw new Error(`SERVICE_REQUIRED_MISSING:${id}`);
      visiting.add(id);
      for (const dependency of descriptor.required ?? []) await visit(dependency.id);
      for (const dependency of descriptor.optional ?? []) if (this.descriptors.has(dependency.id)) await visit(dependency.id);
      visiting.delete(id);
      const serviceScope = this.scope.child(descriptor.scope ?? "host", id);
      this.serviceScopes.set(id, serviceScope);
      const service = await descriptor.start({ scope: serviceScope, get: key => this.get(key), optional: key => this.optional(key) });
      this.services.set(id, service);
      this.order.push(id);
    };
    try { for (const id of this.descriptors.keys()) await visit(id); this.started = true; }
    catch (error) { await this.close().catch(() => undefined); throw error; }
  }
  get<T>(key: ServiceKey<T>): T { if (!this.services.has(key.id)) throw new Error(`SERVICE_NOT_AVAILABLE:${key.id}`); return this.services.get(key.id) as T; }
  optional<T>(key: ServiceKey<T>): T | undefined { return this.services.get(key.id) as T | undefined; }
  async close(): Promise<void> {
    const errors: unknown[] = [];
    for (const id of [...this.order].reverse()) {
      const descriptor = this.descriptors.get(id)!;
      try { await descriptor.stop?.(this.services.get(id)); } catch (error) { errors.push(error); }
      try { await this.serviceScopes.get(id)?.close(); } catch (error) { errors.push(error); }
    }
    this.order.length = 0;
    this.serviceScopes.clear();
    this.services.clear();
    try { await this.scope.close(); } catch (error) { errors.push(error); }
    this.started = false;
    if (errors.length) throw new AggregateError(errors, "SERVICE_REGISTRY_CLOSE_FAILED");
  }
}

export interface AgentHandleLike extends Effect { readonly id: string; readonly sessionId: string; }
export interface AgentOwnershipV1 { readonly parentAgentId?: string; readonly jobId?: string; readonly depth: 0 | 1; }

export class AgentRegistry<T extends AgentHandleLike = AgentHandleLike> implements Effect {
  private readonly agents = new Map<string, { readonly handle: T; readonly scope: RuntimeScope; readonly ownership: AgentOwnershipV1; readonly children: Set<string> }>();
  private closed = false;
  constructor(private readonly parentScope: RuntimeScope) {}
  register(handle: T, scope = this.parentScope.child("agent", handle.id), ownership: AgentOwnershipV1 = { depth: 0 }): T {
    if (this.closed) throw new Error("AGENT_REGISTRY_CLOSED");
    if (this.agents.has(handle.id)) throw new Error(`AGENT_DUPLICATE:${handle.id}`);
    const parent = ownership.parentAgentId ? this.agents.get(ownership.parentAgentId) : undefined;
    if (ownership.parentAgentId && !parent) throw new Error('AGENT_PARENT_NOT_FOUND');
    if (ownership.depth === 1 && parent?.ownership.depth !== 0 || ownership.depth === 0 && ownership.parentAgentId) throw new Error('AGENT_DEPTH_EXCEEDED');
    const children = new Set<string>();
    this.agents.set(handle.id, { handle, scope, ownership, children });
    parent?.children.add(handle.id);
    return handle;
  }
  get(id: string): T | undefined { return this.agents.get(id)?.handle; }
  list(): readonly T[] { return [...this.agents.values()].map(entry => entry.handle); }
  ownership(id: string): AgentOwnershipV1 | undefined { return this.agents.get(id)?.ownership; }
  children(id: string): readonly T[] { return [...(this.agents.get(id)?.children ?? [])].map(childId => this.agents.get(childId)?.handle).filter((handle): handle is T => Boolean(handle)); }
  canCreateChild(id: string): boolean { const parent = this.agents.get(id); return parent?.ownership.depth === 0 && parent.children.size < 2; }
  registerChild<TChild extends AgentHandleLike>(parentId: string, child: TChild, scope?: RuntimeScope, jobId?: string): TChild {
    const parent = this.agents.get(parentId);
    if (!parent) throw new Error('AGENT_PARENT_NOT_FOUND');
    if (parent.ownership.depth !== 0) throw new Error('AGENT_DEPTH_EXCEEDED');
    if (parent.children.size >= 2) throw new Error('SUBAGENT_CONCURRENCY_LIMIT');
    return this.register(child as unknown as T, scope ?? parent.scope.child('agent', child.id), { parentAgentId: parentId, ...(jobId ? { jobId } : {}), depth: 1 }) as unknown as TChild;
  }
  async dispose(id: string): Promise<boolean> {
    const entry = this.agents.get(id);
    if (!entry) return false;
    const errors: unknown[] = [];
    for (const childId of [...entry.children]) try { await this.dispose(childId); } catch (error) { errors.push(error); }
    this.agents.delete(id);
    const parentId = entry.ownership.parentAgentId;
    if (parentId) this.agents.get(parentId)?.children.delete(id);
    try { await entry.handle.close(); } catch (error) { errors.push(error); }
    try { await entry.scope.close(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, `AGENT_DISPOSE_FAILED:${id}`);
    return true;
  }
  async disposeSession(sessionId: string): Promise<number> {
    const ids = [...this.agents.values()].filter(entry => entry.handle.sessionId === sessionId).map(entry => entry.handle.id);
    const errors: unknown[] = [];
    for (const id of ids) try { await this.dispose(id); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, `AGENT_SESSION_DISPOSE_FAILED:${sessionId}`);
    return ids.length;
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const errors: unknown[] = [];
    for (const id of [...this.agents.keys()].reverse()) try { await this.dispose(id); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, "AGENT_REGISTRY_CLOSE_FAILED");
  }
}

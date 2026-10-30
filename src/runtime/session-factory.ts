import type { Readable, Writable } from 'node:stream';
import type { IslaRuntime } from '../core/runtime.js';
import type { AppConfig } from '../config/schema.js';
import type { ContextCheckpoint } from '../core/context.js';
import type { ToolExecutionResult } from '../tools/types.js';
import { createToolCapabilities } from '../tools/composition.js';
import type { WebFetchConfig, WebSearchConfig } from '../config/schema.js';
import type { SessionStore, StoredSession } from '../sessions/store.js';
import type { MemoryRuntime } from '../memory/runtime.js';
import type { TaskBrief } from '../core/agent-loop.js';
import type { TaskStateV1 } from '../core/task-state.js';
import { SessionQuery } from '../sessions/query.js';
import { workspaceKey } from '../sessions/workspace.js';
import { SkillCatalog } from '../skills/catalog.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { StoredSkillCatalogV1 } from '../sessions/store.js';
import type { McpHost } from '../mcp/host.js';
import { composeCapabilitySnapshot, type CapabilityPolicy, type CapabilitySnapshot } from '../capabilities/snapshot.js';
import { createBrowserCapability } from '../tools/browser.js';
import type { BrowserRuntime } from '../browser/runtime.js';
import { BrowserRuntime as BrowserRuntimeImpl } from '../browser/runtime.js';
import { PlaywrightBrowserAdapter } from '../browser/playwright-adapter.js';
import { BrowserConsoleServer } from '../browser/console-server.js';
import { CredentialVault } from '../browser/vault.js';
import { CapabilityCatalog, createCapabilityProvider } from '../capabilities/catalog.js';
import { CapabilityActivator, composeCapabilityStepSnapshot, createCapabilityRoutingTools } from '../capabilities/routing.js';
import { ResourceBridgeClient } from '../resource/bridge-client.js';
import { createResourceCapability } from '../tools/resource.js';
import { randomUUID } from 'node:crypto';
import type { AgentRegistry } from '../core/service-kernel.js';
import type { FileEventStore } from '../core/event-store.js';
import type { JobRuntime } from '../jobs/runtime.js';
import { createSubagentCapability } from '../tools/subagent.js';

export interface SessionFactoryOptions {
  readonly runtime: IslaRuntime;
  readonly config: SessionFactoryConfig;
  readonly sessionStore: SessionStore;
  readonly memoryRuntime?: MemoryRuntime;
  readonly workspaceRoot: string;
  readonly diagnostics?: (event: import('./application.js').DiagnosticEvent) => void;
  readonly browserRuntime?: BrowserRuntime;
  readonly resourceBridge?: ResourceBridgeClient;
  readonly agentRegistry?: AgentRegistry;
  readonly policyRules?: readonly import('../approval/policy.js').PolicyRuleV1[];
  readonly eventStore?: FileEventStore;
  readonly executionProcesses?: import('../tools/process-registry.js').ExecutionProcessRegistry;
  readonly dependencyManager?: import('../dependencies/manager.js').DependencyManager;
  readonly jobs?: JobRuntime;
}
export interface SessionFactoryConfig {
  readonly provider: string;
  readonly model: string;
  readonly systemPrompt?: string;
  readonly maxContextTurns: number;
  readonly maxContextChars: number;
  readonly contextRetainTurns: number;
  readonly maxContextTokens: number;
  readonly maxOutputTokens: number;
  readonly contextReserveTokens: number;
  readonly modelRetries: number;
  readonly timeoutMs?: number;
  readonly webFetch?: WebFetchConfig;
  readonly webSearch?: WebSearchConfig;
  readonly mcpHost?: McpHost;
  readonly capabilityPolicy?: CapabilityPolicy;
  readonly loopBudget?: import('../core/loop-budget.js').LoopBudgetOptions;
}

const browserRuntimes = new Map<string, BrowserRuntime>();
export function hostBrowserRuntime(workspaceRoot: string): BrowserRuntime {
  const existing = browserRuntimes.get(workspaceRoot);
  if (existing) return existing;
  const created = new BrowserRuntimeImpl({ adapter: new PlaywrightBrowserAdapter(), userDataRoot: join(workspaceRoot, '.isla-local', 'browser'), presentation: (process.env.ISLA_BROWSER_PRESENTATION as 'native' | 'console' | 'auto' | undefined) ?? 'auto', onEvent: event => process.stderr.write(`[browser] ${event.type} session=${event.sessionId}${event.controlEpoch === undefined ? '' : ` epoch=${event.controlEpoch}`}\n`) });
  browserRuntimes.set(workspaceRoot, created);
  return created;
}
const browserConsoles = new Map<string, { server: BrowserConsoleServer; url: string; token: string; vault: CredentialVault }>();
export async function ensureBrowserConsole(workspaceRoot: string, port = 43119): Promise<{ url: string; token: string }> {
  const existing = browserConsoles.get(workspaceRoot);
  if (existing) return { url: existing.url, token: existing.token };
  const vault = new CredentialVault(join(workspaceRoot, '.isla-local', 'vault.json'));
  let server = new BrowserConsoleServer({ runtime: hostBrowserRuntime(workspaceRoot), vault, host: '127.0.0.1', port });
  let address;
  try { address = await server.start(); }
  catch (error) {
    if (!(error instanceof Error) || !('code' in error) || (error as Error & { code?: string }).code !== 'EADDRINUSE' || port === 0) throw error;
    server = new BrowserConsoleServer({ runtime: hostBrowserRuntime(workspaceRoot), vault, host: '127.0.0.1', port: 0 });
    address = await server.start();
  }
  const value = { server, url: `http://${address.host}:${address.port}/browser`, token: address.token, vault };
  browserConsoles.set(workspaceRoot, value);
  return { url: value.url, token: value.token };
}
export async function closeBrowserConsole(workspaceRoot: string): Promise<void> { const current = browserConsoles.get(workspaceRoot); if (!current) return; browserConsoles.delete(workspaceRoot); await current.server.close(); await hostBrowserRuntime(workspaceRoot).closeAll(); }

export interface SessionEntryOptions {
  readonly stored: StoredSession;
  readonly resourceTurnId?: string;
  readonly input?: Readable;
  readonly output?: Writable;
  readonly interactive: boolean;
  readonly approvalPolicy?: import('../approval/types.js').ApprovalPolicy;
  readonly approvalService?: import('../approval/types.js').ApprovalService;
  readonly userQuestionService?: import('../user-questions/types.js').UserQuestionService;
  readonly onToolStarted?: (tool: string, callId: string, argumentsJson?: string) => void;
  readonly onToolFinished?: (tool: string, callId: string, result: ToolExecutionResult) => void;
  readonly onModelStepEvent?: (event: import('../core/events.js').ModelStepEvent) => void;
  readonly onTurnPhaseChanged?: (event: import('../core/events.js').TurnPhaseEvent) => void;
  readonly jobMode?: boolean;
  readonly parentAgentId?: string;
  readonly jobId?: string;
  readonly agentId?: string;
}

export function projectStoredSession(storedSession: StoredSession): {
  readonly messages: readonly import('../core/types.js').Message[];
  readonly context?: import('../core/context.js').SessionContext;
  readonly journal?: import('../core/journal.js').SessionJournal;
  readonly task?: TaskBrief | TaskStateV1;
  readonly skillCatalog?: StoredSkillCatalogV1;
  readonly capabilityActivation?: import('../capabilities/routing.js').CapabilityActivationStateV1;
} {
  return {
    messages: storedSession.messages,
    ...('context' in storedSession && storedSession.context ? { context: storedSession.context } : {}),
    ...('journal' in storedSession && storedSession.journal ? { journal: storedSession.journal } : {}),
    ...('task' in storedSession && storedSession.task ? { task: storedSession.task } : {}),
    ...('taskContract' in storedSession && storedSession.taskContract ? { taskContract: storedSession.taskContract } : {}),
    ...('skillCatalog' in storedSession && storedSession.skillCatalog ? { skillCatalog: storedSession.skillCatalog } : {}),
    ...('capabilityActivation' in storedSession && storedSession.capabilityActivation ? { capabilityActivation: storedSession.capabilityActivation } : {}),
    ...('workPlan' in storedSession && storedSession.workPlan ? { workPlan: storedSession.workPlan } : {}),
    ...('workMode' in storedSession && storedSession.workMode ? { workMode: storedSession.workMode } : {}),
  };
}

export function createSessionFactory(options: SessionFactoryOptions) {
  const { runtime, config, sessionStore, memoryRuntime, workspaceRoot, diagnostics, browserRuntime, resourceBridge, agentRegistry, eventStore, policyRules, executionProcesses } = options;
  const agentIds = new WeakMap<import('../core/session.js').ChatSession, string>();
  const sessionIds = new WeakMap<import('../core/session.js').ChatSession, string>();
  const effectiveBrowserRuntime = browserRuntime ?? hostBrowserRuntime(workspaceRoot);
  const browserConsoleUrl = browserConsoles.get(workspaceRoot)?.url;
  const browserConsoleToken = browserConsoles.get(workspaceRoot)?.token;
  const browserVault = browserConsoles.get(workspaceRoot)?.vault;
  const sessionQuery = new SessionQuery(sessionStore);
  const personalSkillsRoot = join(homedir(), '.isla', 'skills');
  const resourceEnabled = config.capabilityPolicy?.resourceEnabled !== false;
  const skillCatalog = new SkillCatalog({ workspaceRoot: personalSkillsRoot, personalRoot: personalSkillsRoot });
  const capabilitySnapshot = (): CapabilitySnapshot => {
    const capabilities = [...createToolCapabilities({ workspaceRoot, sessionQuery, workspaceKey: workspaceKey(workspaceRoot), currentSessionId: () => 'inventory', skillCatalog, ...(executionProcesses ? { executionProcesses } : {}), ...(options.dependencyManager ? { dependencyManager: options.dependencyManager } : {}), ...(config.capabilityPolicy?.skillAllow ? { skillAllow: config.capabilityPolicy.skillAllow } : {}), ...(config.capabilityPolicy?.skillDeny ? { skillDeny: config.capabilityPolicy.skillDeny } : {}), ...(config.webFetch ? { webFetch: config.webFetch } : {}), ...(config.webSearch ? { webSearch: config.webSearch } : {}) }), ...(resourceEnabled && resourceBridge?.isAvailable ? [createResourceCapability(resourceBridge, 'inventory', 'inventory')] : []), ...(effectiveBrowserRuntime ? [createBrowserCapability(effectiveBrowserRuntime)] : []), ...(config.mcpHost?.capabilities() ?? [])];
    const snapshot = composeCapabilitySnapshot(capabilities, skillCatalog.listSync().entries, config.capabilityPolicy);
    if (resourceEnabled && resourceBridge && !resourceBridge.isAvailable) return { ...snapshot, entries: [...snapshot.entries, { id: 'resource', kind: 'builtin-tool', origin: 'resource', available: false, modelVisible: false, userInvocable: true, diagnosticCode: resourceBridge.unavailableReason }] };
    if (!resourceEnabled) return { ...snapshot, entries: [...snapshot.entries, { id: 'resource', kind: 'builtin-tool', origin: 'resource', available: false, modelVisible: false, userInvocable: false, diagnosticCode: 'CAPABILITY_DENIED' }] };
    return snapshot;
  };
  const capabilityCatalog = (sessionId = 'inventory', turnId = 'inventory', userQuestionService?: import('../user-questions/types.js').UserQuestionService): CapabilityCatalog => {
    const catalog = new CapabilityCatalog();
    const capabilities = [...createToolCapabilities({ workspaceRoot, sessionQuery, workspaceKey: workspaceKey(workspaceRoot), currentSessionId: () => sessionId, skillCatalog, ...(executionProcesses ? { executionProcesses } : {}), ...(options.dependencyManager ? { dependencyManager: options.dependencyManager } : {}), ...(config.webFetch ? { webFetch: config.webFetch } : {}), ...(config.webSearch ? { webSearch: config.webSearch } : {}) }), ...(effectiveBrowserRuntime ? [createBrowserCapability(effectiveBrowserRuntime)] : []), ...(config.mcpHost?.capabilities(userQuestionService) ?? [])];
    for (const capability of capabilities) {
      catalog.register(createCapabilityProvider(capability, { ...(config.capabilityPolicy ? { policy: config.capabilityPolicy } : {}), keywords: [capability.id, ...capability.tools.map(tool => tool.definition.name)] }));
    }
    if (resourceEnabled && resourceBridge?.isAvailable) catalog.register(createCapabilityProvider(createResourceCapability(resourceBridge, sessionId, turnId), { id: 'builtin.resource', risk: 'external-side-effect', activation: 'eager', lifetime: 'session', keywords: ['resource job download archive artifact'] }));
    return catalog;
  };
  return {
    capabilitySnapshot,
    capabilityCatalog,
    async dispose(session: import('../core/session.js').ChatSession): Promise<void> {
      const id = agentIds.get(session);
      const sessionId = sessionIds.get(session);
      if (sessionId && executionProcesses) await executionProcesses.closeOwner(sessionId);
      if (id && agentRegistry) { await agentRegistry.dispose(id); agentIds.delete(session); }
      else await session.close();
    },
    create(entry: SessionEntryOptions) {
      let current = entry.stored;
      const agentId = entry.agentId ?? `agent-${randomUUID()}`;
      const fullCapabilities = [...createToolCapabilities({ workspaceRoot, sessionQuery, workspaceKey: workspaceKey(workspaceRoot), currentSessionId: () => current.id, contextMessages: () => current.messages, skillCatalog, ...(executionProcesses ? { executionProcesses } : {}), ...(options.dependencyManager ? { dependencyManager: options.dependencyManager } : {}), ...(config.capabilityPolicy?.skillAllow ? { skillAllow: config.capabilityPolicy.skillAllow } : {}), ...(config.capabilityPolicy?.skillDeny ? { skillDeny: config.capabilityPolicy.skillDeny } : {}), ...(entry.userQuestionService ? { userQuestionService: entry.userQuestionService } : {}), ...(config.webFetch ? { webFetch: config.webFetch } : {}), ...(config.webSearch ? { webSearch: config.webSearch } : {}) }), ...(resourceEnabled && resourceBridge?.isAvailable ? [createResourceCapability(resourceBridge, current.id, entry.resourceTurnId ?? `session-${current.id}`)] : []), ...(effectiveBrowserRuntime ? [createBrowserCapability(effectiveBrowserRuntime, entry.userQuestionService, browserConsoleUrl, browserConsoleToken, browserVault)] : []), ...(config.mcpHost?.capabilities(entry.userQuestionService) ?? [])];
      const readonlySubagentTools = new Set(['read_text_file','list_directory','glob_project','grep_project','search_project','web_fetch','web_search']);
      const composed = entry.jobMode ? fullCapabilities.map(capability => ({ ...capability, tools: capability.tools.filter(tool => readonlySubagentTools.has(tool.definition.name)) })).filter(capability => capability.tools.length > 0) : [...fullCapabilities, ...(options.jobs && agentRegistry ? [createSubagentCapability({ jobs: options.jobs, parentAgentId: agentId, parentSessionId: current.id, workspaceRoot, canCreate: () => agentRegistry.canCreateChild(agentId) })] : [])];
const catalog = capabilityCatalog(current.id, entry.resourceTurnId ?? `session-${current.id}`, entry.userQuestionService);
      const activator = new CapabilityActivator(catalog, ('capabilityActivation' in current && current.capabilityActivation) ? current.capabilityActivation : undefined);
      const routingTools = createCapabilityRoutingTools(catalog, activator, () => 0);
      const routingCapability = { id: 'capability-routing', tools: routingTools } as import('../tools/types.js').ToolCapability;
      const withRouting = entry.jobMode ? composed : [...composed, routingCapability];
      const snapshot = composeCapabilitySnapshot(withRouting, skillCatalog.listSync().entries, config.capabilityPolicy);
      const visible = new Set(snapshot.toolDefinitions.map(tool => tool.name));
      const filtered = withRouting.map(capability => ({ ...capability, tools: capability.tools.filter(tool => visible.has(tool.definition.name)) })).filter(capability => capability.tools.length > 0);
      const session = runtime.createSession({
        providerId: config.provider,
        ...projectStoredSession(current),
        maxContextTurns: config.maxContextTurns,
        maxContextChars: config.maxContextChars,
        contextRetainTurns: config.contextRetainTurns,
        maxContextTokens: config.maxContextTokens,
        maxOutputTokens: config.maxOutputTokens,
        contextReserveTokens: config.contextReserveTokens,
        modelRetries: config.modelRetries,
        enableTools: true,
        enablePlanAct: entry.jobMode !== true,
        skillCatalog: ('skillCatalog' in current && current.skillCatalog) ? current.skillCatalog : { version: 1, entries: skillCatalog.listSync().entries },
        ...('capabilityActivation' in current && current.capabilityActivation ? { capabilityActivation: current.capabilityActivation } : {}),
        ...('workPlan' in current && current.workPlan ? { workPlan: current.workPlan } : {}),
        ...('workMode' in current && current.workMode ? { workMode: current.workMode } : {}),
        agentLoop: true,
        ...(entry.jobMode ? { loopBudget: { initialBudget: 6, extensionSteps: 2, autoLimit: 8, hardLimit: 8 } } : config.loopBudget ? { loopBudget: config.loopBudget } : {}),
        agentLoopTimeoutMs: entry.jobMode ? Math.min(config.timeoutMs ?? 120_000, 120_000) : config.timeoutMs ?? 600_000,
        capabilities: filtered,
        resolveCapabilities: async (input, step, signal) => {
          if (entry.jobMode) return filtered;
          const dynamic = await composeCapabilityStepSnapshot(catalog, activator, input, step, [
            'builtin.control',
            'builtin.project-files',
            'builtin.project-discovery',
            'builtin.command-execution',
            'builtin.task-state',
          ], signal);
          return [...dynamic.capabilities, routingCapability];
        },
        projectRoot: workspaceRoot,
        ...(diagnostics ? { onDiagnostic: diagnostics } : {}),
        permissionPreset: entry.jobMode ? 'readonly' : 'workspace',
        approvalPolicy: entry.approvalPolicy ?? (entry.interactive ? 'ask' : 'never'),
        ...(policyRules ? { policyRules } : {}),
        ...(entry.approvalService ? { approvalService: entry.approvalService } : {}),
        ...(entry.userQuestionService ? { userQuestionService: entry.userQuestionService } : {}),
        ...(memoryRuntime?.enabled ? {
          retrieveContext: async (query: string) => memoryRuntime.buildRequestContext(query, workspaceRoot, current.id),
          onTurnCommitted: async (messages: readonly import('../core/types.js').Message[]) => { try { await memoryRuntime.indexConversation(current.id, messages, workspaceRoot); } finally { await memoryRuntime.captureExplicitMemory(current.id, messages, workspaceRoot); } },
          onContextCompacted: async (checkpoint: ContextCheckpoint) => { memoryRuntime.captureCheckpointCandidates(current.id, checkpoint, workspaceRoot); },
        } : {}),
        ...(entry.onToolStarted ? { onToolStarted: entry.onToolStarted } : {}),
        ...(entry.onToolFinished ? { onToolFinished: entry.onToolFinished } : {}),
        ...(entry.onModelStepEvent ? { onModelStepEvent: entry.onModelStepEvent } : {}),
        ...(entry.onTurnPhaseChanged ? { onTurnPhaseChanged: entry.onTurnPhaseChanged } : {}),
        onSessionStateChanged: async state => {
          current = await sessionStore.save(current, state);
          if (memoryRuntime?.enabled) await memoryRuntime.captureExplicitMemory(current.id, state.messages, workspaceRoot);
        },
        ...(eventStore ? { onSessionEvent: event => eventStore.append(current.id, event).then(() => undefined) } : {}),
      });
      if (agentRegistry) {
        const handle = { id: agentId, sessionId: current.id, close: async () => { await executionProcesses?.closeOwner(current.id); await session.close(); } };
        if (entry.parentAgentId) agentRegistry.registerChild(entry.parentAgentId, handle, undefined, entry.jobId);
        else agentRegistry.register(handle);
        agentIds.set(session, agentId);
      }
      sessionIds.set(session, current.id);
      return session;
    },
  };
}

export async function loadOrCreateSession(store: SessionStore, config: AppConfig): Promise<StoredSession> {
  const latest = await store.loadLatest(config.provider, config.model);
  return latest ?? store.create(config.provider, config.model, config.systemPrompt ? [{ role: 'system', content: config.systemPrompt }] : []);
}

import type { Readable, Writable } from 'node:stream';
import type { IslaRuntime } from './core/runtime.js';
import type { AppConfig } from './config.js';
import type { ContextCheckpoint } from './core/context.js';
import type { ToolExecutionResult } from './tools/types.js';
import { createToolCapabilities } from './tools/composition.js';
import type { WebFetchConfig, WebSearchConfig } from './config.js';
import type { SessionStore, StoredSession } from './session-store.js';
import type { MemoryRuntime } from './memory/runtime.js';
import type { TaskBrief } from './core/agent-loop.js';
import type { TaskStateV1 } from './core/task-state.js';
import { SessionQuery } from './session-query.js';
import { workspaceKey } from './session-workspace.js';
import { SkillCatalog } from './skills/catalog.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { StoredSkillCatalogV1 } from './session-store.js';
import type { McpHost } from './mcp/host.js';
import { composeCapabilitySnapshot, type CapabilityPolicy, type CapabilitySnapshot } from './capabilities.js';
import { createBrowserCapability } from './tools/browser.js';
import type { BrowserRuntime } from './browser/runtime.js';
import { BrowserRuntime as BrowserRuntimeImpl } from './browser/runtime.js';
import { PlaywrightBrowserAdapter } from './browser/playwright-adapter.js';
import { BrowserConsoleServer } from './browser/console-server.js';
import { CredentialVault } from './browser/vault.js';

export interface SessionFactoryOptions {
  readonly runtime: IslaRuntime;
  readonly config: SessionFactoryConfig;
  readonly sessionStore: SessionStore;
  readonly memoryRuntime?: MemoryRuntime;
  readonly workspaceRoot: string;
  readonly diagnostics?: (event: import('./application.js').DiagnosticEvent) => void;
  readonly browserRuntime?: BrowserRuntime;
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
  readonly input?: Readable;
  readonly output?: Writable;
  readonly interactive: boolean;
  readonly approvalPolicy?: import('./approval/types.js').ApprovalPolicy;
  readonly approvalService?: import('./approval/types.js').ApprovalService;
  readonly userQuestionService?: import('./user-questions/types.js').UserQuestionService;
  readonly onToolStarted?: (tool: string, callId: string, argumentsJson?: string) => void;
  readonly onToolFinished?: (tool: string, callId: string, result: ToolExecutionResult) => void;
  readonly onModelStepEvent?: (event: import('./core/events.js').ModelStepEvent) => void;
}

export function projectStoredSession(storedSession: StoredSession): {
  readonly messages: readonly import('./core/types.js').Message[];
  readonly context?: import('./core/context.js').SessionContext;
  readonly journal?: import('./core/journal.js').SessionJournal;
  readonly task?: TaskBrief | TaskStateV1;
  readonly skillCatalog?: StoredSkillCatalogV1;
} {
  return {
    messages: storedSession.messages,
    ...('context' in storedSession && storedSession.context ? { context: storedSession.context } : {}),
    ...('journal' in storedSession && storedSession.journal ? { journal: storedSession.journal } : {}),
    ...('task' in storedSession && storedSession.task ? { task: storedSession.task } : {}),
    ...('skillCatalog' in storedSession && storedSession.skillCatalog ? { skillCatalog: storedSession.skillCatalog } : {}),
  };
}

export function createSessionFactory(options: SessionFactoryOptions) {
  const { runtime, config, sessionStore, memoryRuntime, workspaceRoot, diagnostics, browserRuntime } = options;
  const effectiveBrowserRuntime = browserRuntime ?? hostBrowserRuntime(workspaceRoot);
  const browserConsoleUrl = browserConsoles.get(workspaceRoot)?.url;
  const browserConsoleToken = browserConsoles.get(workspaceRoot)?.token;
  const browserVault = browserConsoles.get(workspaceRoot)?.vault;
  const sessionQuery = new SessionQuery(sessionStore);
  const skillCatalog = new SkillCatalog({ workspaceRoot: join(workspaceRoot, '.isla', 'skills'), personalRoot: join(homedir(), '.isla', 'skills') });
  const capabilitySnapshot = (): CapabilitySnapshot => {
    const capabilities = [...createToolCapabilities({ workspaceRoot, sessionQuery, workspaceKey: workspaceKey(workspaceRoot), currentSessionId: () => 'inventory', skillCatalog, ...(config.capabilityPolicy?.skillAllow ? { skillAllow: config.capabilityPolicy.skillAllow } : {}), ...(config.capabilityPolicy?.skillDeny ? { skillDeny: config.capabilityPolicy.skillDeny } : {}), ...(config.webFetch ? { webFetch: config.webFetch } : {}), ...(config.webSearch ? { webSearch: config.webSearch } : {}) }), ...(effectiveBrowserRuntime ? [createBrowserCapability(effectiveBrowserRuntime)] : []), ...(config.mcpHost?.capabilities() ?? [])];
    return composeCapabilitySnapshot(capabilities, skillCatalog.listSync().entries, config.capabilityPolicy);
  };
  return {
    capabilitySnapshot,
    create(entry: SessionEntryOptions) {
      let current = entry.stored;
        const composed = [...createToolCapabilities({ workspaceRoot, sessionQuery, workspaceKey: workspaceKey(workspaceRoot), currentSessionId: () => current.id, contextMessages: () => current.messages, skillCatalog, ...(config.capabilityPolicy?.skillAllow ? { skillAllow: config.capabilityPolicy.skillAllow } : {}), ...(config.capabilityPolicy?.skillDeny ? { skillDeny: config.capabilityPolicy.skillDeny } : {}), ...(entry.userQuestionService ? { userQuestionService: entry.userQuestionService } : {}), ...(config.webFetch ? { webFetch: config.webFetch } : {}), ...(config.webSearch ? { webSearch: config.webSearch } : {}) }), ...(effectiveBrowserRuntime ? [createBrowserCapability(effectiveBrowserRuntime, entry.userQuestionService, browserConsoleUrl, browserConsoleToken, browserVault)] : []), ...(config.mcpHost?.capabilities() ?? [])];
      const snapshot = composeCapabilitySnapshot(composed, skillCatalog.listSync().entries, config.capabilityPolicy);
      const visible = new Set(snapshot.toolDefinitions.map(tool => tool.name));
      const filtered = composed.map(capability => ({ ...capability, tools: capability.tools.filter(tool => visible.has(tool.definition.name)) })).filter(capability => capability.tools.length > 0);
      return runtime.createSession({
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
        skillCatalog: ('skillCatalog' in current && current.skillCatalog) ? current.skillCatalog : { version: 1, entries: skillCatalog.listSync().entries },
        agentLoop: true,
        agentLoopTimeoutMs: config.timeoutMs ?? 600_000,
        capabilities: filtered,
        projectRoot: workspaceRoot,
        ...(diagnostics ? { onDiagnostic: diagnostics } : {}),
        permissionPreset: 'workspace',
        approvalPolicy: entry.approvalPolicy ?? (entry.interactive ? 'ask' : 'never'),
        ...(entry.approvalService ? { approvalService: entry.approvalService } : {}),
        ...(entry.userQuestionService ? { userQuestionService: entry.userQuestionService } : {}),
        ...(memoryRuntime?.enabled ? {
          retrieveContext: async (query: string) => memoryRuntime.buildRequestContext(query, workspaceRoot, current.id),
          onTurnCommitted: async (messages: readonly import('./core/types.js').Message[]) => { try { await memoryRuntime.indexConversation(current.id, messages, workspaceRoot); } finally { await memoryRuntime.captureExplicitMemory(current.id, messages, workspaceRoot); } },
          onContextCompacted: async (checkpoint: ContextCheckpoint) => { memoryRuntime.captureCheckpointCandidates(current.id, checkpoint, workspaceRoot); },
        } : {}),
        ...(entry.onToolStarted ? { onToolStarted: entry.onToolStarted } : {}),
        ...(entry.onToolFinished ? { onToolFinished: entry.onToolFinished } : {}),
        ...(entry.onModelStepEvent ? { onModelStepEvent: entry.onModelStepEvent } : {}),
        onSessionStateChanged: async state => {
          current = await sessionStore.save(current, state);
          if (memoryRuntime?.enabled) await memoryRuntime.captureExplicitMemory(current.id, state.messages, workspaceRoot);
        },
      });
    },
  };
}

export async function loadOrCreateSession(store: SessionStore, config: AppConfig): Promise<StoredSession> {
  const latest = await store.loadLatest(config.provider, config.model);
  return latest ?? store.create(config.provider, config.model, config.systemPrompt ? [{ role: 'system', content: config.systemPrompt }] : []);
}

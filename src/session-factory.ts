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

export interface SessionFactoryOptions {
  readonly runtime: IslaRuntime;
  readonly config: SessionFactoryConfig;
  readonly sessionStore: SessionStore;
  readonly memoryRuntime?: MemoryRuntime;
  readonly workspaceRoot: string;
  readonly diagnostics?: (event: import('./application.js').DiagnosticEvent) => void;
}
export interface SessionFactoryConfig {
  readonly provider: string;
  readonly model: string;
  readonly systemPrompt?: string;
  readonly maxContextTurns: number;
  readonly maxContextChars: number;
  readonly contextRetainTurns: number;
  readonly modelRetries: number;
  readonly webFetch?: WebFetchConfig;
  readonly webSearch?: WebSearchConfig;
}

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
  readonly task?: TaskBrief;
} {
  return {
    messages: storedSession.messages,
    ...('context' in storedSession && storedSession.context ? { context: storedSession.context } : {}),
    ...('journal' in storedSession && storedSession.journal ? { journal: storedSession.journal } : {}),
    ...('task' in storedSession && storedSession.task ? { task: storedSession.task } : {}),
  };
}

export function createSessionFactory(options: SessionFactoryOptions) {
  const { runtime, config, sessionStore, memoryRuntime, workspaceRoot, diagnostics } = options;
  return {
    create(entry: SessionEntryOptions) {
      let current = entry.stored;
      return runtime.createSession({
        providerId: config.provider,
        ...projectStoredSession(current),
        maxContextTurns: config.maxContextTurns,
        maxContextChars: config.maxContextChars,
        contextRetainTurns: config.contextRetainTurns,
        modelRetries: config.modelRetries,
        enableTools: true,
        agentLoop: true,
        capabilities: createToolCapabilities({ workspaceRoot, ...(entry.userQuestionService ? { userQuestionService: entry.userQuestionService } : {}), ...(config.webFetch ? { webFetch: config.webFetch } : {}), ...(config.webSearch ? { webSearch: config.webSearch } : {}) }),
        projectRoot: workspaceRoot,
        ...(diagnostics ? { onDiagnostic: diagnostics } : {}),
        permissionPreset: 'workspace',
        approvalPolicy: entry.approvalPolicy ?? (entry.interactive ? 'ask' : 'never'),
        ...(entry.approvalService ? { approvalService: entry.approvalService } : {}),
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

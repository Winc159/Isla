import type { IslaRuntime } from '../core/runtime.js';
import { JsonSessionStore, type SessionStore } from '../sessions/store.js';
import { MemoryRuntime } from '../memory/runtime.js';
import { LocalEmbeddingProvider, OpenAIEmbeddingProvider } from '../memory/embeddings.js';
import type { AppConfig } from '../config/schema.js';
import type { McpHost } from '../mcp/host.js';
import { AgentRegistry, RuntimeScope } from '../core/service-kernel.js';
import { FileEventStore } from '../core/event-store.js';

export interface DiagnosticSink { emit(event: DiagnosticEvent): void; }
export interface DiagnosticEvent { readonly code: string; readonly component: string; readonly severity?: 'warning' | 'error' | 'debug'; readonly detail?: string; readonly domain?: import('../core/errors.js').RuntimeErrorDomain; }

export function createStderrDiagnosticSink(level: 'quiet' | 'normal' | 'debug' = 'normal', output: { write(chunk: string): void } = process.stderr): DiagnosticSink {
  const rank = { debug: 0, warning: 1, error: 2 } as const;
  const threshold = level === 'quiet' ? 2 : level === 'normal' ? 1 : 0;
  return { emit: event => { const severity = event.severity ?? 'debug'; if (rank[severity] < threshold) return; output.write(`[${severity}] ${event.code}${event.detail ? `: ${event.detail}` : ''}\n`); } };
}

export interface IslaApplication {
  readonly runtime: IslaRuntime;
  readonly sessions: SessionStore;
  readonly memory: MemoryRuntime;
  readonly diagnostics: DiagnosticSink;
  close(): void;
  dispose(): Promise<void>;
  readonly scope: RuntimeScope;
  readonly agents: AgentRegistry;
  readonly events: FileEventStore;
}

export function createApplication(config: AppConfig, runtime: IslaRuntime, options: { readonly sessionStore?: SessionStore; readonly diagnostics?: DiagnosticSink; readonly mcpHost?: McpHost } = {}): IslaApplication {
  const diagnostics = options.diagnostics ?? { emit: () => {} };
  const embeddingProvider = config.embeddingProvider === 'openai' && config.embeddingModel && config.embeddingApiKey
    ? new OpenAIEmbeddingProvider(config.embeddingModel, config.embeddingApiKey, config.embeddingBaseURL, config.timeoutMs)
    : config.embeddingProvider === 'local' && config.embeddingModel && config.embeddingBaseURL
      ? new LocalEmbeddingProvider(config.embeddingModel, config.embeddingBaseURL, config.timeoutMs)
      : undefined;
  const memory = MemoryRuntime.open({
    enabled: config.memoryEnabled,
    ...(config.memoryDatabase ? { path: config.memoryDatabase } : {}),
    ...(embeddingProvider ? { embeddingProvider } : {}),
    onWarning: message => diagnostics.emit({ code: 'MEMORY_UNAVAILABLE', component: 'memory', severity: 'warning', detail: message }),
  });
  let closed = false;
  const scope = new RuntimeScope('host', 'isla-application');
  const agents = new AgentRegistry(scope);
  const events = new FileEventStore(`${config.sessionDirectory}/events`);
  scope.defer(() => memory.close());
  if (options.mcpHost) scope.defer(() => options.mcpHost!.close());
  scope.defer(() => agents.close());
  let disposal: Promise<void> | undefined;
  return {
    runtime,
    sessions: options.sessionStore ?? new JsonSessionStore(config.sessionDirectory),
    memory,
    diagnostics,
    scope,
    agents,
    events,
    close: () => { if (closed) return; closed = true; void scope.close(); },
    dispose: () => {
      if (disposal) return disposal;
      closed = true;
      disposal = scope.close();
      return disposal;
    },
  };
}

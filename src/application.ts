import type { IslaRuntime } from './core/runtime.js';
import { JsonSessionStore, type SessionStore } from './session-store.js';
import { MemoryRuntime } from './memory/runtime.js';
import { LocalEmbeddingProvider, OpenAIEmbeddingProvider } from './memory/embeddings.js';
import type { AppConfig } from './config.js';

export interface DiagnosticSink { emit(event: DiagnosticEvent): void; }
export interface DiagnosticEvent { readonly code: string; readonly component: string; readonly severity?: 'warning' | 'error' | 'debug'; readonly detail?: string; }

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
}

export function createApplication(config: AppConfig, runtime: IslaRuntime, options: { readonly sessionStore?: SessionStore; readonly diagnostics?: DiagnosticSink } = {}): IslaApplication {
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
  return {
    runtime,
    sessions: options.sessionStore ?? new JsonSessionStore(config.sessionDirectory),
    memory,
    diagnostics,
    close: () => { if (closed) return; closed = true; memory.close(); },
  };
}

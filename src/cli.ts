#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { performance } from 'node:perf_hooks';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { isInteractiveInput } from './cli/command.js';
import { findCliCommand, listCliCommands } from './cli/commands.js';
import { readInteractiveMessage } from './cli/input-editor.js';
import { DEFAULT_MAX_CONTEXT_TURNS } from './core/session.js';
import { loadRuntime } from './main.js';
import { JsonSessionStore, type SessionStore, type StoredSession } from './session-store.js';
import { CliApprovalService } from './approval/cli-approval.js';
import { runProtocol } from './protocol/runner.js';
import type { MemoryRuntime } from './memory/runtime.js';
import { MemoryRuntime as DefaultMemoryRuntime } from './memory/runtime.js';
import { LocalEmbeddingProvider, OpenAIEmbeddingProvider } from './memory/embeddings.js';
export async function runCli(
  input: Readable,
  output: Writable,
  errorOutput: Writable,
  runtime: import('./core/runtime.js').IslaRuntime,
  providerId: string,
  model: string,
  systemPrompt?: string,
  debug = false,
  maxContextTurns = DEFAULT_MAX_CONTEXT_TURNS,
  sessionStore: SessionStore = new JsonSessionStore(),
  maxContextChars = 60000,
  contextRetainTurns = 6,
  memoryRuntime?: MemoryRuntime,
  modelRetries = 0,
): Promise<void> {
  writeHeader(output, providerId, model);
  const latestSession = await sessionStore.loadLatest(providerId, model);
  let storedSession: StoredSession;
  if (latestSession) {
    storedSession = latestSession;
  } else {
    storedSession = await sessionStore.create(
      providerId,
      model,
      systemPrompt ? [{ role: 'system', content: systemPrompt }] : [],
    );
  }
  const interactive = isInteractiveInput(input);
  let session = createPersistentSession(runtime, providerId, storedSession, sessionStore, maxContextTurns, maxContextChars, contextRetainTurns, output, input, interactive, memoryRuntime, modelRetries);
  const history: string[] = [];
  let draft = '';

  const handleLine = async (line: string): Promise<'continue' | 'exit'> => {
    const command = findCliCommand(line);
    if (command) {
      const result = await command.execute({
          input,
          output,
          providerId,
          model,
          systemPrompt,
          sessionStore,
          commandLine: line,
          ...(memoryRuntime?.store ? { memoryStore: memoryRuntime.store } : {}),
          ...(memoryRuntime ? { memoryRuntime } : {}),
          currentSession: storedSession,
          availableCommands: listCliCommands(),
      });
      if (result.type === 'exit') {
        return 'exit';
      }
      if (result.type === 'switch-session') {
        storedSession = result.session;
        session = createPersistentSession(runtime, providerId, storedSession, sessionStore, maxContextTurns, maxContextChars, contextRetainTurns, output, input, interactive, memoryRuntime, modelRetries);
        output.write('\x1b[2J\x1b[3J\x1b[H');
        writeHeader(output, providerId, model);
        if (result.replayHistory) writeSessionHistory(output, storedSession);
        draft = '';
      } else if (interactive && command.inputMode === 'raw') {
        draft = line;
      }
      return 'continue';
    }
    if (!line.trim()) return 'continue';
    draft = '';
    history.push(line);
    const startedAt = performance.now();
    const stopLoading = startLoading(output, startedAt);
    try {
      const response = await session.send(line);
      stopLoading();
      output.write('isla> ');
      output.write(`${response.text}\n耗时 ${formatElapsed(startedAt)}\n\n`);
      if (response.projectSources?.length) output.write(`参考：\n${response.projectSources.map(source => `- ${source.path}:${source.startLine}`).join("\n")}\n\n`);
    } catch (error) {
      stopLoading();
      if (debug) {
        const name = error instanceof Error ? error.name : 'UnknownError';
        const message = error instanceof Error ? error.message : 'Unknown error';
        const category = /timeout|timed out/i.test(message) || /timeout/i.test(name)
          ? 'timeout'
          : /network|connection|fetch/i.test(message) || /connection/i.test(name)
            ? 'network'
            : 'provider';
        errorOutput.write(`[debug] provider=${providerId} model=${model} error=${name} category=${category}\n`);
      }
      errorOutput.write(
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}\n耗时 ${formatElapsed(startedAt)}\n`,
      );
    }
    return 'continue';
  };

  if (interactive) {
    while (true) {
      const result = await readInteractiveMessage(input, output, history, draft, listCliCommands());
      if (result.type === 'exit') break;
      if (await handleLine(result.value) === 'exit') break;
    }
    return;
  }

  const rl = createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    if (await handleLine(line) === 'exit') break;
  }
}

function writeSessionHistory(output: Writable, session: StoredSession): void {
  for (const message of session.messages) {
    if (message.role === 'system') continue;
    output.write(`${message.role === 'user' ? 'you' : 'isla'}> ${message.content}\n`);
  }
  output.write('\n');
}

function startLoading(output: Writable, startedAt: number, label = '生成中'): () => void {
  if (!(output as Writable & { isTTY?: boolean }).isTTY) return () => {};
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frame = 0;
  const render = () => {
    output.write(`\risla> ${frames[frame % frames.length]} ${label} ${formatElapsed(startedAt)}`);
    frame += 1;
  };
  render();
  const timer = setInterval(render, 1000);
  timer.unref();
  return () => {
    clearInterval(timer);
    output.write('\r\x1b[2K');
  };
}

function formatElapsed(startedAt: number): string {
  const totalSeconds = Math.floor((performance.now() - startedAt) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return minutes > 0 ? `${minutes}m${seconds}s` : `${seconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours}h${minutes % 60}m`;
}

function writeHeader(output: Writable, providerId: string, model: string): void {
  output.write(
    `Isla v0 · provider=${providerId} · model=${model}\nmaster,你好，我叫（Error划掉）Isla，很高兴认识你\n输入 /new 开启新对话，输入 /sessions 选择会话，输入 /exit 或按 Esc 退出。\n\n`,
  );
}

function createPersistentSession(
  runtime: import('./core/runtime.js').IslaRuntime,
  providerId: string,
  storedSession: StoredSession,
  sessionStore: SessionStore,
  maxContextTurns: number,
  maxContextChars: number,
  contextRetainTurns: number,
  output: Writable,
  input: Readable,
  interactive: boolean,
  memoryRuntime?: MemoryRuntime,
  modelRetries = 0,
) {
  let current = storedSession;
  return runtime.createSession({
    providerId,
    messages: current.messages,
    ...('context' in current && current.context ? { context: current.context } : {}),
    ...(current.journal ? { journal: current.journal } : {}),
    maxContextTurns,
    maxContextChars,
    contextRetainTurns,
    modelRetries,
    enableTools: true,
    projectRoot: process.cwd(),
    permissionPreset: 'workspace',
    approvalPolicy: interactive ? 'ask' : 'never',
    ...(memoryRuntime?.enabled ? {
      retrieveContext: async (query: string) => memoryRuntime.buildRequestContext(query, process.cwd(), current.id),
      onTurnCommitted: async (messages: readonly import('./core/types.js').Message[]) => { try { await memoryRuntime.indexConversation(current.id, messages, process.cwd()); } finally { await memoryRuntime.captureExplicitMemory(current.id, messages, process.cwd()); } },
      onContextCompacted: async (checkpoint: import('./core/context.js').ContextCheckpoint) => { memoryRuntime.captureCheckpointCandidates(current.id, checkpoint, process.cwd()); },
    } : {}),
    ...(interactive ? { approvalService: new CliApprovalService(input, output) } : {}),
    onSessionStateChanged: async state => {
      current = await sessionStore.save(current, state);
      if (memoryRuntime?.enabled) await memoryRuntime.captureExplicitMemory(current.id, state.messages, process.cwd());
    },
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const { runtime, config } = loadRuntime();
    const embeddingProvider = config.embeddingProvider === 'openai' && config.embeddingModel && config.embeddingApiKey
      ? new OpenAIEmbeddingProvider(config.embeddingModel, config.embeddingApiKey, config.embeddingBaseURL, config.timeoutMs)
      : config.embeddingProvider === 'local' && config.embeddingModel && config.embeddingBaseURL
        ? new LocalEmbeddingProvider(config.embeddingModel, config.embeddingBaseURL, config.timeoutMs)
        : undefined;
    const memoryRuntime = DefaultMemoryRuntime.open({ enabled: config.memoryEnabled, ...(config.memoryDatabase ? { path: config.memoryDatabase } : {}), ...(embeddingProvider ? { embeddingProvider } : {}), onWarning: message => process.stderr.write(`${message}\n`) });
    try {
    if (process.argv.includes('--protocol')) {
      const protocol = process.argv[process.argv.indexOf('--protocol') + 1];
      if (protocol !== 'ndjson') throw new Error('Unsupported protocol');
      const protocolStore = new JsonSessionStore(config.sessionDirectory);
      let protocolStored = await protocolStore.loadLatest(config.provider, config.model);
      if (!protocolStored) protocolStored = await protocolStore.create(config.provider, config.model, config.systemPrompt ? [{ role: 'system', content: config.systemPrompt }] : []);
      let useExistingProtocolSession = true;
      await runProtocol(process.stdin, process.stdout, undefined, config.provider, config.model, {
        createSession: async (approvalService, events) => {
          if (!useExistingProtocolSession) protocolStored = await protocolStore.create(config.provider, config.model, config.systemPrompt ? [{ role: 'system', content: config.systemPrompt }] : []);
          useExistingProtocolSession = false;
          return runtime.createSession({ providerId: config.provider, ...(protocolStored ? { messages: protocolStored.messages } : {}), ...(protocolStored?.version === 2 && protocolStored.context ? { context: protocolStored.context } : {}), ...(config.systemPrompt ? { systemPrompt: config.systemPrompt } : {}), maxContextTurns: config.maxContextTurns, maxContextChars: config.maxContextChars, contextRetainTurns: config.contextRetainTurns, modelRetries: config.modelRetries, enableTools: true, projectRoot: process.cwd(), permissionPreset: 'workspace', approvalPolicy: 'ask', approvalService, ...(memoryRuntime.enabled && protocolStored ? { retrieveContext: async (query: string) => memoryRuntime.buildRequestContext(query, process.cwd(), protocolStored?.id), onTurnCommitted: async (messages: readonly import('./core/types.js').Message[]) => { if (protocolStored) { try { await memoryRuntime.indexConversation(protocolStored.id, messages, process.cwd()); } finally { await memoryRuntime.captureExplicitMemory(protocolStored.id, messages, process.cwd()); } } }, onContextCompacted: async (checkpoint: import('./core/context.js').ContextCheckpoint) => { if (protocolStored) memoryRuntime.captureCheckpointCandidates(protocolStored.id, checkpoint, process.cwd()); } } : {}), onToolStarted: events.onToolStarted, onToolFinished: events.onToolFinished, onSessionStateChanged: async state => { if (protocolStored) { protocolStored = await protocolStore.save(protocolStored, state); if (memoryRuntime.enabled) await memoryRuntime.captureExplicitMemory(protocolStored.id, state.messages, process.cwd()); } } });
        },
        sessionId: () => protocolStored?.id ?? 'unknown',
      });
      memoryRuntime.close();
      process.exit(0);
    } else await runCli(
      process.stdin,
      process.stdout,
      process.stderr,
      runtime,
      config.provider,
      config.model,
      config.systemPrompt,
      config.debug,
      config.maxContextTurns,
      new JsonSessionStore(config.sessionDirectory),
      config.maxContextChars,
      config.contextRetainTurns,
      memoryRuntime,
      config.modelRetries,
    );
    } finally { memoryRuntime.close(); }
  } catch (error) {
    process.stderr.write(
      `Error: ${error instanceof Error ? error.message : 'Unknown error'}\n`,
    );
    process.exitCode = 1;
  }
}

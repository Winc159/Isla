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
import { ConfigStore, defaultConfigPath } from './config-store.js';
import { parseCliStartupArgs } from './cli-args.js';
import { runSetupWizard } from './cli/setup-wizard.js';
import { createApplication, createStderrDiagnosticSink } from './application.js';
import { createSessionFactory } from './session-factory.js';
import type { ChatSession } from './core/session.js';

export interface CliInterruptController {
  start(): void;
  stop(): void;
  readonly cancelling: boolean;
}

export function createCliInterruptController(
  session: Pick<ChatSession, 'cancelActiveTurn'>,
  output: Pick<Writable, 'write'>,
  options: { readonly signalSource?: { on(event: 'SIGINT', listener: () => void): unknown; off(event: 'SIGINT', listener: () => void): unknown }; readonly forceExit?: (code: number) => void } = {},
): CliInterruptController {
  const source = options.signalSource ?? process;
  const forceExit = options.forceExit ?? (code => process.exit(code));
  let cancelling = false;
  let started = false;
  const onSigint = () => {
    if (cancelling) { forceExit(130); return; }
    if (session.cancelActiveTurn({ kind: 'user' })) {
      cancelling = true;
      output.write('\n正在取消本轮…\n');
    }
  };
  return {
    start: () => { if (started) return; started = true; source.on('SIGINT', onSigint); },
    stop: () => { if (!started) return; started = false; source.off('SIGINT', onSigint); cancelling = false; },
    get cancelling() { return cancelling; },
  };
}
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
  configStore?: import('./config-store.js').ConfigStore,
  configPath?: string,
  profileName?: string,
  openConfig?: (path: string) => Promise<void>,
  logLevel: 'quiet' | 'normal' | 'debug' = 'normal',
  workspaceRoot = process.cwd(),
  diagnostics?: (event: import('./application.js').DiagnosticEvent) => void,
  webFetch?: import('./config.js').WebFetchConfig,
  webSearch?: import('./config.js').WebSearchConfig,
): Promise<void> {
  writeHeader(output, providerId, model, workspaceRoot, webFetch?.enabled === true);
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
  let session = createPersistentSession(runtime, providerId, systemPrompt, storedSession, sessionStore, maxContextTurns, maxContextChars, contextRetainTurns, output, input, interactive, memoryRuntime, modelRetries, workspaceRoot, diagnostics, webFetch, webSearch);
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
          ...(configStore ? { configStore } : {}),
          ...(configPath ? { configPath } : {}),
          ...(profileName ? { profileName } : {}),
          ...(openConfig ? { openConfig } : {}),
      });
      if (result.type === 'exit') {
        return 'exit';
      }
      if (result.type === 'switch-session') {
        storedSession = result.session;
        session = createPersistentSession(runtime, providerId, systemPrompt, storedSession, sessionStore, maxContextTurns, maxContextChars, contextRetainTurns, output, input, interactive, memoryRuntime, modelRetries, workspaceRoot, diagnostics, webFetch, webSearch);
        output.write('\x1b[2J\x1b[3J\x1b[H');
        writeHeader(output, providerId, model, workspaceRoot);
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
    const stopLoading = startLoading(output, startedAt, '生成中', logLevel !== 'debug');
    const interrupt = interactive ? createCliInterruptController(session, output) : undefined;
    interrupt?.start();
    try {
      const response = await session.send(line);
      stopLoading();
      output.write('isla> ');
      output.write(`${response.text}\n`);
      if (logLevel !== 'quiet') output.write(`耗时 ${formatElapsed(startedAt)}\n`);
      output.write('\n');
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
    } finally {
      await session.whenIdle();
      interrupt?.stop();
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

export interface CliAdapterOptions {
  readonly input: Readable;
  readonly output: Writable;
  readonly errorOutput: Writable;
  readonly runtime: import('./core/runtime.js').IslaRuntime;
  readonly providerId: string;
  readonly model: string;
  readonly systemPrompt?: string;
  readonly debug?: boolean;
  readonly maxContextTurns?: number;
  readonly sessionStore: SessionStore;
  readonly maxContextChars?: number;
  readonly contextRetainTurns?: number;
  readonly memoryRuntime?: MemoryRuntime;
  readonly modelRetries?: number;
  readonly configStore?: import('./config-store.js').ConfigStore;
  readonly configPath?: string;
  readonly profileName?: string;
  readonly openConfig?: (path: string) => Promise<void>;
  readonly logLevel?: 'quiet' | 'normal' | 'debug';
  readonly workspaceRoot: string;
  readonly diagnostics?: (event: import('./application.js').DiagnosticEvent) => void;
  readonly webFetch?: import('./config.js').WebFetchConfig;
  readonly webSearch?: import('./config.js').WebSearchConfig;
}

export async function runCliAdapter(options: CliAdapterOptions): Promise<void> {
  return runCli(options.input, options.output, options.errorOutput, options.runtime, options.providerId, options.model, options.systemPrompt, options.debug, options.maxContextTurns, options.sessionStore, options.maxContextChars, options.contextRetainTurns, options.memoryRuntime, options.modelRetries, options.configStore, options.configPath, options.profileName, options.openConfig, options.logLevel, options.workspaceRoot, options.diagnostics, options.webFetch, options.webSearch);
}

function writeSessionHistory(output: Writable, session: StoredSession): void {
  for (const message of session.messages) {
    if (message.role === 'system') continue;
    output.write(`${message.role === 'user' ? 'you' : 'isla'}> ${message.content}\n`);
  }
  output.write('\n');
}

function startLoading(output: Writable, startedAt: number, label = '生成中', enabled = true): () => void {
  if (!enabled) return () => {};
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

function writeHeader(output: Writable, providerId: string, model: string, workspaceRoot = process.cwd(), webFetchEnabled = false): void {
  output.write(
    `Isla v0 · provider=${providerId} · model=${model} · workspace=${workspaceRoot} · web_fetch=${webFetchEnabled ? 'on' : 'off'}\nmaster,你好，我叫（Error划掉）Isla，很高兴认识你\n输入 /new 开启新对话，输入 /sessions 选择会话，输入 /exit 或按 Esc 退出。\n\n`,
  );
}

function createPersistentSession(
  runtime: import('./core/runtime.js').IslaRuntime,
  providerId: string,
  systemPrompt: string | undefined,
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
  workspaceRoot = process.cwd(),
  diagnostics?: (event: import('./application.js').DiagnosticEvent) => void,
  webFetch?: import('./config.js').WebFetchConfig,
  webSearch?: import('./config.js').WebSearchConfig,
) {
  const factory = createSessionFactory({ runtime, config: { provider: providerId, model: storedSession.model, ...(systemPrompt ? { systemPrompt } : {}), maxContextTurns, maxContextChars, contextRetainTurns, modelRetries, ...(webFetch ? { webFetch } : {}), ...(webSearch ? { webSearch } : {}) }, sessionStore, ...(memoryRuntime ? { memoryRuntime } : {}), workspaceRoot, ...(diagnostics ? { diagnostics } : {}) });
  return factory.create({ stored: storedSession, input, output, interactive, ...(interactive ? { approvalService: new CliApprovalService(input, output) } : {}) });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const startupArgs = parseCliStartupArgs(process.argv.slice(2));
    if (!startupArgs.useEnv && !startupArgs.profileName && process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      const configStore = new ConfigStore(startupArgs.configPath ?? defaultConfigPath());
      const configState = await configStore.load();
      if (configState.status === 'missing' || configState.status === 'empty') {
        const completed = await runSetupWizard(process.stdin, process.stdout, configStore, process.stdin as unknown as import('./cli/command.js').InteractiveInput);
        if (!completed) process.exit(1);
      }
    }
    const { runtime, config, startup } = await loadRuntime();
    const application = createApplication(config, runtime, { diagnostics: createStderrDiagnosticSink(config.logLevel ?? (config.debug ? 'debug' : 'normal'), process.stderr) });
    const memoryRuntime = application.memory;
    try {
    if (startup.protocol !== undefined) {
      const protocol = startup.protocol;
      if (protocol !== 'ndjson') throw new Error('Unsupported protocol');
      const protocolStore = application.sessions;
      const sessionFactory = createSessionFactory({ runtime, config, sessionStore: protocolStore, memoryRuntime, workspaceRoot: config.workspaceRoot ?? process.cwd(), diagnostics: event => application.diagnostics.emit(event) });
      let protocolStored = await protocolStore.loadLatest(config.provider, config.model);
      if (!protocolStored) protocolStored = await protocolStore.create(config.provider, config.model, config.systemPrompt ? [{ role: 'system', content: config.systemPrompt }] : []);
      let useExistingProtocolSession = true;
      await runProtocol(process.stdin, process.stdout, undefined, config.provider, config.model, {
        ...(config.workspaceRoot ? { workspace: config.workspaceRoot } : {}),
        capabilities: { toolCalling: true, cancellation: true, streaming: false, webFetch: config.webFetch?.enabled === true, webSearch: config.webSearch?.enabled === true },
        createSession: async (approvalService, events) => {
          if (!useExistingProtocolSession) protocolStored = await protocolStore.create(config.provider, config.model, config.systemPrompt ? [{ role: 'system', content: config.systemPrompt }] : []);
          useExistingProtocolSession = false;
          const activeStored = protocolStored;
          if (!activeStored) throw new Error('Protocol session is not configured');
          return sessionFactory.create({ stored: activeStored, interactive: false, approvalPolicy: 'ask', approvalService, onToolStarted: events.onToolStarted, onToolFinished: events.onToolFinished });
        },
        sessionId: () => protocolStored?.id ?? 'unknown',
      });
      application.close();
      process.exit(0);
    } else await runCliAdapter({
      input: process.stdin,
      output: process.stdout,
      errorOutput: process.stderr,
      runtime,
      providerId: config.provider,
      model: config.model,
      ...(config.systemPrompt ? { systemPrompt: config.systemPrompt } : {}),
      debug: config.debug,
      maxContextTurns: config.maxContextTurns,
      sessionStore: application.sessions,
      maxContextChars: config.maxContextChars,
      contextRetainTurns: config.contextRetainTurns,
      memoryRuntime,
      modelRetries: config.modelRetries,
      configStore: new ConfigStore(startup.configPath ?? defaultConfigPath()),
      configPath: startup.configPath ?? defaultConfigPath(),
      ...(startup.profileName ? { profileName: startup.profileName } : {}),
      ...(config.logLevel ? { logLevel: config.logLevel } : {}),
      workspaceRoot: config.workspaceRoot ?? process.cwd(),
      ...(config.webFetch ? { webFetch: config.webFetch } : {}),
      ...(config.webSearch ? { webSearch: config.webSearch } : {}),
      diagnostics: event => application.diagnostics.emit(event),
    });
    } finally { application.close(); }
  } catch (error) {
    process.stderr.write(
      `Error: ${error instanceof Error ? error.message : 'Unknown error'}\n`,
    );
    process.exitCode = 1;
  }
}

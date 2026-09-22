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
import { workspaceKey } from './session-workspace.js';
import type { ChatSession } from './core/session.js';
import { listBailianModels } from './models/bailian-catalog.js';
import { listDeepSeekModels } from './models/deepseek-catalog.js';
import { CliUserQuestionService } from './user-questions/cli.js';
import { SessionQuery } from './session-query.js';
import { SkillCatalog } from './skills/catalog.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { McpHost } from './mcp/host.js';
import type { CapabilityPolicy } from './capabilities.js';

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
  mcpHost?: McpHost,
  capabilityPolicy?: CapabilityPolicy,
): Promise<void> {
  writeHeader(output, providerId, model, workspaceRoot, webFetch?.enabled === true);
  const currentWorkspaceKey = workspaceKey(workspaceRoot);
  const sessionQuery = new SessionQuery(sessionStore);
  const latestSession = await sessionStore.loadLatest(providerId, model, currentWorkspaceKey);
  let storedSession: StoredSession;
  if (latestSession) {
    storedSession = latestSession;
  } else {
    storedSession = await sessionStore.create(
      providerId,
      model,
      systemPrompt ? [{ role: 'system', content: systemPrompt }] : [],
      currentWorkspaceKey,
    );
  }
  const interactive = isInteractiveInput(input);
  const inventoryFactory = createSessionFactory({ runtime, config: { provider: providerId, model, maxContextTurns, maxContextChars, contextRetainTurns, modelRetries, ...(webFetch ? { webFetch } : {}), ...(webSearch ? { webSearch } : {}), ...(mcpHost ? { mcpHost } : {}), ...(capabilityPolicy ? { capabilityPolicy } : {}) }, sessionStore, workspaceRoot });
  let session: ChatSession;
  const history: string[] = [];
  let draft = '';
  const streamingDisplay = interactive && (output as Writable & { isTTY?: boolean }).isTTY === true && runtime.getProviderCapabilities(providerId)?.nativeStreaming === true;
  const streamState = { sawDelta: false, hadToolStep: false };
  let stopActiveLoading = (): void => {};
  const onModelStepEvent = (event: import('./core/events.js').ModelStepEvent): void => {
    if (!streamingDisplay) return;
    if (event.type === 'model_step_start') return;
    if (event.type === 'model_delta') {
      if (!streamState.sawDelta) output.write('isla> ');
      streamState.sawDelta = true;
      output.write(event.text);
    } else if (event.result === 'capability_calls') {
      streamState.hadToolStep = true;
      if (streamState.sawDelta) output.write('\n');
    }
  };
  session = createPersistentSession(runtime, providerId, systemPrompt, storedSession, sessionStore, maxContextTurns, maxContextChars, contextRetainTurns, output, input, interactive, memoryRuntime, modelRetries, workspaceRoot, diagnostics, webFetch, webSearch, onModelStepEvent, () => stopActiveLoading(), mcpHost);

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
          sessionQuery,
          commandLine: line,
          ...(memoryRuntime?.store ? { memoryStore: memoryRuntime.store } : {}),
          ...(memoryRuntime ? { memoryRuntime } : {}),
          currentSession: storedSession,
          availableCommands: listCliCommands(),
          ...(configStore ? { configStore } : {}),
          ...(configPath ? { configPath } : {}),
          ...(profileName ? { profileName } : {}),
          workspaceRoot,
          ...(openConfig ? { openConfig } : {}),
          ...(mcpHost ? { mcpHost } : {}),
          capabilitySnapshot: inventoryFactory.capabilitySnapshot,
      });
      if (result.type === 'exit') {
        return 'exit';
      }
      if (result.type === 'switch-session') {
        storedSession = result.session;
        session = createPersistentSession(runtime, providerId, systemPrompt, storedSession, sessionStore, maxContextTurns, maxContextChars, contextRetainTurns, output, input, interactive, memoryRuntime, modelRetries, workspaceRoot, diagnostics, webFetch, webSearch, onModelStepEvent, () => stopActiveLoading(), mcpHost);
        output.write('\x1b[2J\x1b[3J\x1b[H');
        writeHeader(output, providerId, model, workspaceRoot);
        if (result.replayHistory) writeSessionHistory(output, storedSession);
        draft = '';
      } else if (result.type === 'invoke-skill') {
        draft = '';
        const startedAt = performance.now();
        const stopLoading = startLoading(output, startedAt, '生成中', logLevel !== 'debug' && !streamingDisplay);
        stopActiveLoading = stopLoading;
        const interrupt = interactive ? createCliInterruptController(session, output) : undefined;
        interrupt?.start();
        try {
          const response = await session.sendWithSkill({ name: result.name, ...(result.userInput ? { userInput: result.userInput } : {}), content: result.content });
          stopLoading(); interrupt?.stop();
          output.write(`isla> ${response.text}\n\n`);
        } catch (error) {
          stopLoading(); interrupt?.stop();
          errorOutput.write(`Error: ${error instanceof Error ? error.message : 'Unknown error'}\n耗时 ${formatElapsed(startedAt)}\n`);
        }
      } else if (interactive && command.inputMode === 'raw') {
        draft = line;
      }
      return 'continue';
    }
    if (!line.trim()) return 'continue';
    draft = '';
    history.push(line);
    const startedAt = performance.now();
    streamState.sawDelta = false;
    streamState.hadToolStep = false;
    const stopLoading = startLoading(output, startedAt, '生成中', logLevel !== 'debug' && !streamingDisplay);
    stopActiveLoading = stopLoading;
    const interrupt = interactive ? createCliInterruptController(session, output) : undefined;
    interrupt?.start();
    try {
      const response = await session.send(line);
      stopLoading();
      if (streamState.sawDelta && !streamState.hadToolStep) output.write('\n');
      else output.write(`isla> ${response.text}\n`);
      if (response.verificationStatus === 'passed_after_last_change') output.write('验证：已通过\n');
      else if (response.verificationStatus === 'not_run') output.write('验证：未运行\n');
      else if (response.verificationStatus === 'failed_after_last_change') output.write('验证：失败\n');
      if (logLevel !== 'quiet') output.write(`耗时 ${formatElapsed(startedAt)}\n`);
      output.write('\n');
      if (response.projectSources?.length) output.write(`参考：\n${response.projectSources.map(source => `- ${source.path}:${source.startLine}`).join("\n")}\n\n`);
    } catch (error) {
      stopLoading();
      if (streamState.sawDelta) output.write('\n');
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
      stopActiveLoading = () => {};
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
  readonly mcpHost?: McpHost;
  readonly capabilityPolicy?: CapabilityPolicy;
}

export async function runCliAdapter(options: CliAdapterOptions): Promise<void> {
  return runCli(options.input, options.output, options.errorOutput, options.runtime, options.providerId, options.model, options.systemPrompt, options.debug, options.maxContextTurns, options.sessionStore, options.maxContextChars, options.contextRetainTurns, options.memoryRuntime, options.modelRetries, options.configStore, options.configPath, options.profileName, options.openConfig, options.logLevel, options.workspaceRoot, options.diagnostics, options.webFetch, options.webSearch, options.mcpHost, options.capabilityPolicy);
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
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
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
  onModelStepEvent?: (event: import('./core/events.js').ModelStepEvent) => void,
  onQuestion?: () => void,
  mcpHost?: McpHost,
) {
  const factory = createSessionFactory({ runtime, config: { provider: providerId, model: storedSession.model, ...(systemPrompt ? { systemPrompt } : {}), maxContextTurns, maxContextChars, contextRetainTurns, modelRetries, ...(webFetch ? { webFetch } : {}), ...(webSearch ? { webSearch } : {}), ...(mcpHost ? { mcpHost } : {}) }, sessionStore, ...(memoryRuntime ? { memoryRuntime } : {}), workspaceRoot, ...(diagnostics ? { diagnostics } : {}) });
  return factory.create({ stored: storedSession, input, output, interactive, ...(interactive ? { approvalService: new CliApprovalService(input, output), userQuestionService: new CliUserQuestionService(input, output, onQuestion) } : {}), ...(onModelStepEvent ? { onModelStepEvent } : {}) });
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
    const { runtime, config, startup, mcpHost } = await loadRuntime();
    if (startup.models) process.exit(0);
    const application = createApplication(config, runtime, { diagnostics: createStderrDiagnosticSink(config.logLevel ?? (config.debug ? 'debug' : 'normal'), process.stderr), ...(mcpHost ? { mcpHost } : {}) });
    const memoryRuntime = application.memory;
    try {
    if (startup.protocol !== undefined) {
      const protocol = startup.protocol;
      if (protocol !== 'ndjson') throw new Error('Unsupported protocol');
      const protocolStore = application.sessions;
      const sessionFactory = createSessionFactory({ runtime, config: { ...config, ...(mcpHost ? { mcpHost } : {}) }, sessionStore: protocolStore, memoryRuntime, workspaceRoot: config.workspaceRoot ?? process.cwd(), diagnostics: event => application.diagnostics.emit(event) });
      const currentWorkspaceKey = workspaceKey(config.workspaceRoot ?? process.cwd());
      let protocolStored = await protocolStore.loadLatest(config.provider, config.model, currentWorkspaceKey);
      if (!protocolStored) protocolStored = await protocolStore.create(config.provider, config.model, config.systemPrompt ? [{ role: 'system', content: config.systemPrompt }] : [], currentWorkspaceKey);
      let useExistingProtocolSession = true;
      let selectedProtocolSession = protocolStored;
      let activeProtocolSession: ChatSession | undefined;
      const protocolSkillCatalog = new SkillCatalog({ workspaceRoot: join(config.workspaceRoot ?? process.cwd(), '.isla', 'skills'), personalRoot: join(homedir(), '.isla', 'skills') });
      await runProtocol(process.stdin, process.stdout, undefined, config.provider, config.model, {
        ...(config.workspaceRoot ? { workspace: config.workspaceRoot } : {}),
        capabilities: { toolCalling: runtime.getProviderCapabilities(config.provider)?.toolCalling === true, cancellation: true, streaming: runtime.getProviderCapabilities(config.provider)?.nativeStreaming === true, streamingToolCalls: runtime.getProviderCapabilities(config.provider)?.streamingToolCalls === true, webFetch: config.webFetch?.enabled === true, webSearch: config.webSearch?.enabled === true, userQuestions: true, mcp: Boolean(mcpHost) },
        ...(mcpHost ? { mcpHost } : {}),
        capabilitySnapshot: sessionFactory.capabilitySnapshot,
        invokeSkill: async (name, text) => {
          const definition = protocolSkillCatalog.loadSync(name);
          if (!definition || !definition.userInvocable) throw new Error('Skill 不存在或不可由用户调用');
          if (!activeProtocolSession) throw new Error('Protocol session is not configured');
          return activeProtocolSession.sendWithSkill({ name, ...(text ? { userInput: text } : {}), content: definition.content });
        },
        createSession: async (approvalService, events, questionService) => {
          if (!useExistingProtocolSession) protocolStored = selectedProtocolSession;
          useExistingProtocolSession = false;
          const activeStored = protocolStored;
          if (!activeStored) throw new Error('Protocol session is not configured');
          activeProtocolSession = sessionFactory.create({ stored: activeStored, interactive: false, approvalPolicy: 'ask', approvalService, userQuestionService: questionService, onToolStarted: events.onToolStarted, onToolFinished: events.onToolFinished, onModelStepEvent: events.onModelStepEvent });
          return activeProtocolSession;
        },
        sessionId: () => protocolStored?.id ?? 'unknown',
        sessionQuery: new SessionQuery(protocolStore),
        workspaceKey: currentWorkspaceKey,
        selectSession: async sessionId => {
          const selected = await new SessionQuery(protocolStore).getSession(currentWorkspaceKey, sessionId);
          if (!selected) return false;
          selectedProtocolSession = selected;
          useExistingProtocolSession = false;
          return true;
        },
        beforeNewSession: async () => {
          selectedProtocolSession = await protocolStore.create(config.provider, config.model, config.systemPrompt ? [{ role: 'system', content: config.systemPrompt }] : [], currentWorkspaceKey);
          useExistingProtocolSession = false;
        },
        ...(config.provider === 'bailian' ? { listModels: query => listBailianModels(config.baseURL, config.apiKey, query ? { search: query } : {}), useModel: async nextModel => { const models = await listBailianModels(config.baseURL, config.apiKey); if (!models.some(entry => entry.id === nextModel)) throw new Error('模型不在当前目录中'); const store = new ConfigStore(startup.configPath ?? defaultConfigPath()); const loaded = await store.load(); const name = startup.profileName ?? (loaded.status === 'ready' ? loaded.config.defaultProfile : undefined); if (loaded.status !== 'ready' || !name || loaded.config.profiles[name]?.provider !== 'bailian') throw new Error('Bailian Profile 不可用'); await store.save({ ...loaded.config, profiles: { ...loaded.config.profiles, [name]: { ...loaded.config.profiles[name]!, model: nextModel } } }, loaded.revision); } } : config.provider === 'deepseek' ? { listModels: query => listDeepSeekModels(config.apiKey).then(models => query ? models.filter(entry => entry.id.toLowerCase().includes(query.toLowerCase())) : models), useModel: async nextModel => { const models = await listDeepSeekModels(config.apiKey); if (!models.some(entry => entry.id === nextModel)) throw new Error('模型不在当前目录中'); const store = new ConfigStore(startup.configPath ?? defaultConfigPath()); const loaded = await store.load(); const name = startup.profileName ?? (loaded.status === 'ready' ? loaded.config.defaultProfile : undefined); if (loaded.status !== 'ready' || !name || loaded.config.profiles[name]?.provider !== 'deepseek') throw new Error('DeepSeek Profile 不可用'); await store.save({ ...loaded.config, profiles: { ...loaded.config.profiles, [name]: { ...loaded.config.profiles[name]!, model: nextModel } } }, loaded.revision); } } : {}),
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
      ...(mcpHost ? { mcpHost } : {}),
      ...(config.capabilityPolicy ? { capabilityPolicy: config.capabilityPolicy } : {}),
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

#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { performance } from 'node:perf_hooks';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MAX_CONTEXT_TURNS } from './core/session.js';
import { loadRuntime } from './main.js';
import { JsonSessionStore, type SessionStore, type StoredSession } from './session-store.js';
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
): Promise<void> {
  writeHeader(output, providerId, model);
  let storedSession = await sessionStore.loadLatest(providerId, model);
  if (!storedSession) {
    storedSession = await sessionStore.create(
      providerId,
      model,
      systemPrompt ? [{ role: 'system', content: systemPrompt }] : [],
    );
  }
  let session = createPersistentSession(runtime, providerId, storedSession, sessionStore, maxContextTurns);
  const rl = createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line === '/exit') {
      rl.close();
      break;
    }
    if (line === '/new') {
      storedSession = await sessionStore.create(
        providerId,
        model,
        systemPrompt ? [{ role: 'system', content: systemPrompt }] : [],
      );
      session = createPersistentSession(runtime, providerId, storedSession, sessionStore, maxContextTurns);
      output.write('\x1b[2J\x1b[3J\x1b[H');
      writeHeader(output, providerId, model);
      continue;
    }
    if (!line.trim()) continue;
    const startedAt = performance.now();
    const stopLoading = startLoading(output, startedAt);
    try {
      const response = await session.send(line);
      stopLoading();
      output.write(`isla> ${response.text}\n耗时 ${formatElapsed(startedAt)}\n\n`);
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
  }
}

function startLoading(output: Writable, startedAt: number): () => void {
  if (!(output as Writable & { isTTY?: boolean }).isTTY) return () => {};
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frame = 0;
  const render = () => {
    output.write(`\risla> ${frames[frame % frames.length]} 生成中 ${formatElapsed(startedAt)}`);
    frame += 1;
  };
  render();
  const timer = setInterval(render, 100);
  timer.unref();
  return () => {
    clearInterval(timer);
    output.write('\r\x1b[2K');
  };
}

function formatElapsed(startedAt: number): string {
  return `${((performance.now() - startedAt) / 1000).toFixed(1)}s`;
}

function writeHeader(output: Writable, providerId: string, model: string): void {
  output.write(
    `Isla v0 · provider=${providerId} · model=${model}\n输入 /new 开启新对话，输入 /exit 或按 Ctrl+C 退出。\n\n`,
  );
}

function createPersistentSession(
  runtime: import('./core/runtime.js').IslaRuntime,
  providerId: string,
  storedSession: StoredSession,
  sessionStore: SessionStore,
  maxContextTurns: number,
) {
  let current = storedSession;
  return runtime.createSession({
    providerId,
    messages: current.messages,
    maxContextTurns,
    onMessagesChanged: async messages => {
      current = await sessionStore.save(current, messages);
    },
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const { runtime, config } = loadRuntime();
    await runCli(
      process.stdin,
      process.stdout,
      process.stderr,
      runtime,
      config.provider,
      config.model,
      config.systemPrompt,
      config.debug,
      config.maxContextTurns,
    );
  } catch (error) {
    process.stderr.write(
      `Error: ${error instanceof Error ? error.message : 'Unknown error'}\n`,
    );
    process.exitCode = 1;
  }
}

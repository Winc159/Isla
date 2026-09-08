#!/usr/bin/env node
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { loadRuntime } from './main.js';
export async function runCli(
  input: Readable,
  output: Writable,
  errorOutput: Writable,
  runtime: import('./core/runtime.js').IslaRuntime,
  providerId: string,
  model: string,
  systemPrompt?: string,
  debug = false,
): Promise<void> {
  output.write(
    `Isla v0 · provider=${providerId} · model=${model}\n输入 /exit 或按 Ctrl+C 退出。\n\n`,
  );
  const session = runtime.createSession({
    providerId,
    ...(systemPrompt ? { systemPrompt } : {}),
  });
  const rl = createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line === '/exit') {
      rl.close();
      break;
    }
    if (!line.trim()) continue;
    output.write(`you> ${line}\n`);
    try {
      const response = await session.send(line);
      output.write(`isla> ${response.text}\n\n`);
    } catch (error) {
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
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}\n`,
      );
    }
  }
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
    );
  } catch (error) {
    process.stderr.write(
      `Error: ${error instanceof Error ? error.message : 'Unknown error'}\n`,
    );
    process.exitCode = 1;
  }
}

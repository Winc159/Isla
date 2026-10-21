#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { createApplication, createStderrDiagnosticSink } from '../runtime/application.js';
import { ResidentHost } from '../host/server.js';
import { defaultLocalRuntimeConfigPath, loadOrCreateLocalRuntimeConfig } from '../config/local-runtime.js';
import { loadRuntime } from '../runtime/bootstrap.js';
import { createSessionFactory } from '../runtime/session-factory.js';

const loaded = await loadRuntime();
const application = createApplication(loaded.config, loaded.runtime, { diagnostics: createStderrDiagnosticSink(loaded.config.logLevel ?? 'normal', process.stderr), ...(loaded.mcpHost ? { mcpHost: loaded.mcpHost } : {}) });
const workspaceRoot = loaded.config.workspaceRoot ?? process.cwd();
const factory = createSessionFactory({ runtime: loaded.runtime, config: { ...loaded.config, ...(loaded.mcpHost ? { mcpHost: loaded.mcpHost } : {}) }, sessionStore: application.sessions, memoryRuntime: application.memory, workspaceRoot, diagnostics: event => application.diagnostics.emit(event) });
const runtimePath = defaultLocalRuntimeConfigPath();
const local = await loadOrCreateLocalRuntimeConfig(runtimePath);
const host = new ResidentHost({
  host: local.host.host,
  port: local.host.port,
  token: local.host.token,
  lockPath: join(dirname(runtimePath), 'host.lock'),
  provider: loaded.config.provider,
  model: loaded.config.model,
  sessionStore: application.sessions,
  createSession: (stored, requestedWorkspace) => requestedWorkspace
    ? createSessionFactory({ runtime: loaded.runtime, config: { ...loaded.config, ...(loaded.mcpHost ? { mcpHost: loaded.mcpHost } : {}) }, sessionStore: application.sessions, memoryRuntime: application.memory, workspaceRoot: requestedWorkspace, diagnostics: event => application.diagnostics.emit(event) }).create({ stored, interactive: false, approvalPolicy: 'never' })
    : factory.create({ stored, interactive: false, approvalPolicy: 'never' }),
  ...(loaded.config.systemPrompt ? { initialMessages: [{ role: 'system' as const, content: loaded.config.systemPrompt }] } : {}),
  capabilitySnapshot: factory.capabilitySnapshot,
  ...(loaded.worker ? { structuredInference: loaded.worker.inference } : {}),
});

const address = await host.start();
process.stdout.write(`Isla Resident Host 已启动：http://${address.host}:${address.port}\n`);

let closing = false;
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  await host.close();
  application.close();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void close().finally(() => process.exit(0)); });

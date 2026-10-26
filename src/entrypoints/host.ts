#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { createApplication, createStderrDiagnosticSink } from '../runtime/application.js';
import { ResidentHost } from '../host/server.js';
import { defaultLocalRuntimeConfigPath, loadOrCreateLocalRuntimeConfig } from '../config/local-runtime.js';
import { loadRuntime } from '../runtime/bootstrap.js';
import { createSessionFactory } from '../runtime/session-factory.js';
import { ResourceBridgeClient } from '../resource/bridge-client.js';

const loaded = await loadRuntime();
const application = createApplication(loaded.config, loaded.runtime, { diagnostics: createStderrDiagnosticSink(loaded.config.logLevel ?? 'normal', process.stderr), ...(loaded.mcpHost ? { mcpHost: loaded.mcpHost } : {}) });
const workspaceRoot = loaded.config.workspaceRoot ?? process.cwd();
const runtimePath = defaultLocalRuntimeConfigPath();
const local = await loadOrCreateLocalRuntimeConfig(runtimePath);
const resourceHost = local.resource.host === '0.0.0.0' ? '127.0.0.1' : local.resource.host;
const resourceBridge = new ResourceBridgeClient(`http://${resourceHost}:${local.resource.port}`, local.resource.token);
if (loaded.config.capabilityPolicy?.resourceEnabled !== false) await resourceBridge.health();
const factory = createSessionFactory({ runtime: loaded.runtime, config: { ...loaded.config, ...(loaded.mcpHost ? { mcpHost: loaded.mcpHost } : {}) }, sessionStore: application.sessions, memoryRuntime: application.memory, resourceBridge, workspaceRoot, diagnostics: event => application.diagnostics.emit(event), agentRegistry: application.agents, eventStore: application.events });
const host = new ResidentHost({
  host: local.host.host,
  port: local.host.port,
  token: local.host.token,
  lockPath: join(dirname(runtimePath), 'host.lock'),
  provider: loaded.config.provider,
  model: loaded.config.model,
  sessionStore: application.sessions,
  ...(application.memory.store ? { memoryStore: application.memory.store } : {}),
  contextLimits: { maxContextTurns: loaded.config.maxContextTurns, maxContextChars: loaded.config.maxContextChars, maxContextTokens: loaded.config.maxContextTokens, maxOutputTokens: loaded.config.maxOutputTokens, contextReserveTokens: loaded.config.contextReserveTokens, contextRetainTurns: loaded.config.contextRetainTurns },
  createSession: (stored, requestedWorkspace, events) => requestedWorkspace
    ? createSessionFactory({ runtime: loaded.runtime, config: { ...loaded.config, ...(loaded.mcpHost ? { mcpHost: loaded.mcpHost } : {}) }, sessionStore: application.sessions, memoryRuntime: application.memory, resourceBridge, workspaceRoot: requestedWorkspace, diagnostics: event => application.diagnostics.emit(event), agentRegistry: application.agents }).create({ stored, interactive: false, approvalPolicy: events?.approvalService ? 'ask' : 'never', ...(events?.turnId ? { resourceTurnId: events.turnId } : {}), ...(events?.approvalService ? { approvalService: events.approvalService } : {}), ...(events?.userQuestionService ? { userQuestionService: events.userQuestionService } : {}), ...(events ? { onModelStepEvent: events.onModelStepEvent, onToolStarted: events.onToolStarted, onToolFinished: events.onToolFinished } : {}) })
    : factory.create({ stored, interactive: false, approvalPolicy: events?.approvalService ? 'ask' : 'never', ...(events?.turnId ? { resourceTurnId: events.turnId } : {}), ...(events?.approvalService ? { approvalService: events.approvalService } : {}), ...(events?.userQuestionService ? { userQuestionService: events.userQuestionService } : {}), ...(events ? { onModelStepEvent: events.onModelStepEvent, onToolStarted: events.onToolStarted, onToolFinished: events.onToolFinished } : {}) }),
  ...(loaded.config.systemPrompt ? { initialMessages: [{ role: 'system' as const, content: loaded.config.systemPrompt }] } : {}),
  capabilitySnapshot: factory.capabilitySnapshot,
  agentRegistry: application.agents,
  eventStore: application.events,
  ...(loaded.worker ? { structuredInference: loaded.worker.inference } : {}),
});

const address = await host.start();
process.stdout.write(`Isla Resident Host 已启动：http://${address.host}:${address.port}\n`);

let closing = false;
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  await host.close();
  await application.dispose();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void close().finally(() => process.exit(0)); });

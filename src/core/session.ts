import type { ModelProvider, Message, ModelResponse, ProjectSourceReference, ToolDefinition, ToolResponse } from "./types.js";
import { composeRequestMessages } from "../prompts/compose.js";
import type { ToolCapability, ToolExecutionResult } from "../tools/types.js";
import { createProjectFilesCapability } from "../tools/project-files.js";
import { ToolRegistry } from "../tools/registry.js";
import { ToolRuntime } from "../tools/runtime.js";
import type { ApprovalPolicy, ApprovalService } from "../approval/types.js";
import type { PermissionPreset } from "../approval/presets.js";
import { isRuntimeError, RuntimeError, type TurnCancelReason } from "./errors.js";
import type { ModelAttemptRecord, SessionJournal, TurnActionRecord, TurnRecord } from "./journal.js";
import { createRequestSnapshot } from "./request-snapshot.js";
import { validateAndCleanCitations } from "./citations.js";
import type { SessionEvent } from "./events.js";
import {
  appendCheckpoint,
  buildContextProjection,
  COMPACTION_SECTIONS,
  DEFAULT_CONTEXT_RETAIN_TURNS,
  DEFAULT_MAX_CONTEXT_CHARS,
  hasCompactionSections,
  renderMessagesForCompaction,
  selectCompactionUnits,
  shouldCompact,
  type SessionContext,
  type ContextCheckpoint,
} from "./context.js";
export const DEFAULT_MAX_CONTEXT_TURNS = 20;
export const DEFAULT_MAX_TOOL_ROUNDS = 8;
export interface ChatSessionOptions {
  readonly systemPrompt?: string;
  readonly messages?: readonly Message[];
  readonly maxContextTurns?: number;
  readonly maxContextChars?: number;
  readonly contextRetainTurns?: number;
  readonly modelRetries?: number;
  readonly context?: SessionContext;
  readonly journal?: SessionJournal;
  readonly onMessagesChanged?: (messages: readonly Message[]) => Promise<void>;
  readonly onSessionStateChanged?: (state: { readonly messages: readonly Message[]; readonly context?: SessionContext; readonly journal?: SessionJournal }) => Promise<void>;
  readonly onSessionEvent?: (event: SessionEvent) => Promise<void>;
  readonly projectRoot?: string;
  readonly onToolsUsed?: (tools: readonly string[]) => void;
  readonly onToolStarted?: (tool: string, callId: string) => void;
  readonly onToolFinished?: (tool: string, callId: string, result: ToolExecutionResult) => void;
  readonly enableTools?: boolean;
  readonly approvalPolicy?: ApprovalPolicy;
  readonly approvalService?: ApprovalService;
  readonly permissionPreset?: PermissionPreset;
  readonly retrieveContext?: (input: string, visibleMessages: readonly Message[]) => Promise<string | undefined>;
  readonly onTurnCommitted?: (messages: readonly Message[]) => Promise<void>;
  readonly onContextCompacted?: (checkpoint: ContextCheckpoint) => Promise<void>;
  readonly capabilities?: readonly ToolCapability[];
  readonly onDiagnostic?: (event: { readonly code: string; readonly component: string; readonly severity: 'warning' | 'error' | 'debug' }) => void;
}
export class ChatSession {
  private readonly messages: Message[];
  private readonly maxContextTurns: number;
  private readonly maxContextChars: number;
  private readonly contextRetainTurns: number;
  private readonly modelRetries: number;
  private context: SessionContext | undefined;
  constructor(private readonly provider: ModelProvider, options: ChatSessionOptions = {}) {
    this.messages = options.messages
      ? [...options.messages]
      : options.systemPrompt
        ? [{ role: "system", content: options.systemPrompt }]
        : [];
    this.maxContextTurns = options.maxContextTurns ?? DEFAULT_MAX_CONTEXT_TURNS;
    if (!Number.isInteger(this.maxContextTurns) || this.maxContextTurns <= 0)
      throw new Error("maxContextTurns must be a positive integer");
    this.maxContextChars = options.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
    if (!Number.isInteger(this.maxContextChars) || this.maxContextChars <= 0)
      throw new Error("maxContextChars must be a positive integer");
    this.contextRetainTurns = options.contextRetainTurns ?? DEFAULT_CONTEXT_RETAIN_TURNS;
    this.modelRetries = options.modelRetries ?? 0;
    if (!Number.isInteger(this.modelRetries) || this.modelRetries < 0 || this.modelRetries > 1) throw new Error("modelRetries must be 0 or 1");
    if (!Number.isInteger(this.contextRetainTurns) || this.contextRetainTurns <= 0)
      throw new Error("contextRetainTurns must be a positive integer");
    this.context = options.context;
    this.journal = options.journal ?? { version: 1, turns: [] };
    this.onMessagesChanged = options.onMessagesChanged;
    this.onSessionStateChanged = options.onSessionStateChanged;
    this.onSessionEvent = options.onSessionEvent;
    this.projectRoot = options.projectRoot;
    this.onToolsUsed = options.onToolsUsed;
    this.onToolStarted = options.onToolStarted;
    this.onToolFinished = options.onToolFinished;
    this.enableTools = options.enableTools ?? false;
    this.retrieveContext = options.retrieveContext;
    this.onTurnCommitted = options.onTurnCommitted;
    this.onContextCompacted = options.onContextCompacted;
    this.onDiagnostic = options.onDiagnostic;
    // Explicit capabilities are the application path; retain the projectRoot fallback for direct legacy ChatSession callers.
    this.capabilities = this.enableTools && this.provider.generateWithTools ? (options.capabilities ?? (this.projectRoot ? [createProjectFilesCapability(this.projectRoot)] : [])) : [];
    this.toolRegistry = new ToolRegistry();
    for (const capability of this.capabilities) this.toolRegistry.registerCapability(capability);
    this.toolRuntime = new ToolRuntime(this.toolRegistry, {
      approvalPolicy: options.approvalPolicy,
      approvalService: options.approvalService,
      permissionPreset: options.permissionPreset,
    });
  }
  private readonly onMessagesChanged: ((messages: readonly Message[]) => Promise<void>) | undefined;
  private readonly onSessionStateChanged: ((state: { readonly messages: readonly Message[]; readonly context?: SessionContext; readonly journal?: SessionJournal }) => Promise<void>) | undefined;
  private readonly journal: SessionJournal;
  private readonly onSessionEvent: ((event: SessionEvent) => Promise<void>) | undefined;
  private readonly projectRoot: string | undefined;
  private readonly onToolsUsed: ((tools: readonly string[]) => void) | undefined;
  private readonly onToolStarted: ((tool: string, callId: string) => void) | undefined;
  private readonly onToolFinished: ((tool: string, callId: string, result: ToolExecutionResult) => void) | undefined;
  private readonly enableTools: boolean;
  private readonly retrieveContext: ((input: string, visibleMessages: readonly Message[]) => Promise<string | undefined>) | undefined;
  private readonly onTurnCommitted: ((messages: readonly Message[]) => Promise<void>) | undefined;
  private readonly onContextCompacted: ((checkpoint: ContextCheckpoint) => Promise<void>) | undefined;
  private readonly onDiagnostic: ((event: { readonly code: string; readonly component: string; readonly severity: 'warning' | 'error' | 'debug' }) => void) | undefined;
  private readonly capabilities: readonly ToolCapability[];
  private readonly toolRegistry: ToolRegistry;
  private readonly toolRuntime: ToolRuntime;
  private activeTurn: { readonly controller: AbortController; readonly promise: Promise<ModelResponse> } | undefined;
  private readonly retrievedProjectSources = new Set<string>();
  private readonly projectSourceReferences = new Map<string, ProjectSourceReference>();
  async send(input: string): Promise<ModelResponse> {
    if (this.activeTurn) throw new RuntimeError({ code: "UNKNOWN", recoverable: true, message: "当前回合仍在执行。" });
    const controller = new AbortController();
    const promise = this.runTurn(input, controller.signal).finally(() => {
      if (this.activeTurn?.controller === controller) this.activeTurn = undefined;
    });
    this.activeTurn = { controller, promise };
    return promise;
  }

  cancelActiveTurn(reason: TurnCancelReason = { kind: "user" }): boolean {
    const active = this.activeTurn;
    if (!active || active.controller.signal.aborted) return false;
    active.controller.abort(reason);
    return true;
  }

  async whenIdle(): Promise<void> {
    const active = this.activeTurn;
    if (!active) return;
    await active.promise.catch(() => undefined);
  }

  private async generateWithAvailableTools(request: { messages: Message[] }, signal: AbortSignal): Promise<ModelResponse> {
    const provider = this.provider;
    if (!this.enableTools || !provider.generateWithTools) return provider.generate(request, { signal });
    let current = request.messages;
    const evidence: string[] = [];
    const failures = new Map<string, number>();
    const successfulWrites = new Set<string>();
    const tools: readonly ToolDefinition[] = this.toolRegistry.definitions();
    for (let round = 0; round < DEFAULT_MAX_TOOL_ROUNDS; round += 1) {
      const response = await this.generateModel({ messages: current, tools }, true, signal);
      if (!response.toolCalls?.length) {
        return { ...response, ...(evidence.length ? { evidence } : {}), ...(this.projectSourceReferences.size ? { projectSources: [...this.projectSourceReferences.values()] } : {}) };
      }
      const assistantToolMessage = { role: "assistant" as const, content: "", toolCalls: response.toolCalls };
      const next = [...current, assistantToolMessage];
      await this.appendMessage(assistantToolMessage);
      for (let callIndex = 0; callIndex < response.toolCalls.length; callIndex += 1) {
        const call = response.toolCalls[callIndex]!;
        const writeKey = `${call.name}:${call.arguments}`;
        await this.onSessionEvent?.({ type: "tool_call", callId: call.id, tool: call.name, arguments: call.arguments });
        this.onToolStarted?.(call.name, call.id);
        if (call.name === "write_text_file" && successfulWrites.has(writeKey)) {
          const duplicateResult: ToolExecutionResult = { ok: true, content: "相同写入已在本轮成功执行，未重复写入。" };
          this.onToolFinished?.(call.name, call.id, duplicateResult);
          await this.onSessionEvent?.({ type: "tool_result", callId: call.id, tool: call.name, result: duplicateResult });
          await this.appendMessage({ role: "tool", toolCallId: call.id, content: duplicateResult.content });
          await this.appendSkippedToolResults(response.toolCalls.slice(callIndex + 1), "相同写入已完成，本批次其余调用未执行。");
          return { text: "写入已完成，已停止重复写入。", outcome: "completed", evidence, model: response.model ?? provider.model };
        }
        let result: string;
        let terminalResponse: ModelResponse | undefined;
        let execution: ToolExecutionResult = { ok: false, code: "EXECUTION_FAILED", message: "Tool execution interrupted" };
        try {
          execution = await this.toolRuntime.execute(call, { signal });
          if (execution.ok && (call.name === "list_directory" || call.name === "read_text_file")) evidence.push(call.name);
          if (execution.ok && execution.details?.type === "project_search") {
            const sourceIds = [...new Set(execution.details.sources.map(source => source.id))].sort();
            const references = new Map<string, ProjectSourceReference>();
            for (const source of execution.details.sources) {
              const existing = this.projectSourceReferences.get(source.id);
              const reference = { path: source.path, startLine: source.startLine };
              if (existing && (existing.path !== reference.path || existing.startLine !== reference.startLine)) {
                terminalResponse = { text: "项目来源身份冲突，已停止本轮执行。", outcome: "blocked", evidence, ...(this.projectSourceReferences.size ? { projectSources: [...this.projectSourceReferences.values()] } : {}), ...(response.model ? { model: response.model } : {}) };
                continue;
              }
              references.set(source.id, reference);
            }
            for (const sourceId of sourceIds) {
              this.retrievedProjectSources.add(sourceId);
              const reference = references.get(sourceId);
              if (reference) this.projectSourceReferences.set(sourceId, reference);
            }
            const turn = this.journal.turns.at(-1);
            if (turn && sourceIds.length) {
              const action: TurnActionRecord = { type: "project_retrieval", sourceIds, truncated: execution.details.truncated };
              (turn.actions as TurnActionRecord[]).push(action);
            }
          }
          if (execution.ok && call.name === "write_text_file") successfulWrites.add(writeKey);
          result = execution.ok ? execution.content : `[${execution.code}] ${execution.message}`;
          if (!execution.ok) {
            if (execution.code === "USER_REJECTED") {
              terminalResponse = { text: "用户拒绝了工具调用，已停止本轮执行。", outcome: "blocked", evidence, ...(this.projectSourceReferences.size ? { projectSources: [...this.projectSourceReferences.values()] } : {}), ...(response.model ? { model: response.model } : {}) };
            }
            const key = `${call.name}:${call.arguments}:${execution.code}`;
            const count = (failures.get(key) ?? 0) + 1;
            failures.set(key, count);
            if (count >= 2) terminalResponse = { text: "工具调用连续失败，已停止自动重试。", outcome: "blocked", evidence, ...(this.projectSourceReferences.size ? { projectSources: [...this.projectSourceReferences.values()] } : {}), ...(response.model ? { model: response.model } : {}) };
          }
        } finally {
          const turn = this.journal.turns.at(-1);
          if (turn) (turn.actions as TurnActionRecord[]).push({ type: "tool", step: round, callId: call.id, tool: call.name, ok: execution.ok, ...(!execution.ok ? { code: execution.code } : {}) });
          await this.persistState(false);
          this.onToolFinished?.(call.name, call.id, execution);
          await this.onSessionEvent?.({ type: "tool_result", callId: call.id, tool: call.name, result: execution });
        }
        if (!execution.ok && execution.code === "TURN_CANCELLED") throw new RuntimeError({ code: "TURN_CANCELLED", recoverable: false, message: "当前回合已取消。" });
        this.onToolsUsed?.([call.name]);
        const toolMessage = { role: "tool" as const, toolCallId: call.id, content: result };
        next.push(toolMessage);
        await this.appendMessage(toolMessage);
        if (terminalResponse) {
          await this.appendSkippedToolResults(response.toolCalls.slice(callIndex + 1), "本批次前序调用已使执行停止。", next);
          return terminalResponse;
        }
      }
      current = next;
    }
    return { text: "工具调用达到本轮上限，已停止继续执行。", outcome: "blocked", model: provider.model };
  }

  private generateModel(request: { readonly messages: readonly Message[]; readonly tools: readonly ToolDefinition[] }, withTools: true, signal: AbortSignal): Promise<ToolResponse>;
  private generateModel(request: { readonly messages: readonly Message[]; readonly tools?: readonly ToolDefinition[] }, withTools: false, signal: AbortSignal): Promise<ModelResponse>;
  private async generateModel(request: { readonly messages: readonly Message[]; readonly tools?: readonly ToolDefinition[] }, withTools: boolean, signal: AbortSignal): Promise<ModelResponse | ToolResponse> {
    const turn = this.journal.turns.at(-1);
    for (let attempt = 0; ; attempt += 1) {
      const record: ModelAttemptRecord = { attempt: attempt + 1, step: turn?.attempts.length ?? 0, startedAt: new Date().toISOString(), status: "running", request: createRequestSnapshot(request, this.provider.id, this.provider.model, "v0", [...this.retrievedProjectSources].sort()) };
      if (turn) { (turn.attempts as ModelAttemptRecord[]).push(record); await this.persistState(false); }
      try {
        if (signal.aborted) throw new RuntimeError({ code: "TURN_CANCELLED", recoverable: false, message: "当前回合已取消。" });
        const response = withTools && this.provider.generateWithTools ? await this.provider.generateWithTools(request, { signal }) : await this.provider.generate(request, { signal });
        record.status = "succeeded"; record.endedAt = new Date().toISOString(); await this.persistState(false);
        return response;
      } catch (error) {
        record.status = signal.aborted || (isRuntimeError(error) && error.code === "TURN_CANCELLED") ? "aborted" : "failed"; record.endedAt = new Date().toISOString(); if (isRuntimeError(error)) record.error = error.toRecord(); await this.persistState(false);
        if (signal.aborted || (isRuntimeError(error) && error.code === "TURN_CANCELLED")) throw new RuntimeError({ code: "TURN_CANCELLED", recoverable: false, message: "当前回合已取消." });
        if (attempt >= this.modelRetries || !isRuntimeError(error) || !error.recoverable || !["PROVIDER_TIMEOUT", "PROVIDER_NETWORK", "PROVIDER_RATE_LIMIT"].includes(error.code)) throw error;
      }
    }
  }

  private async runTurn(input: string, signal: AbortSignal): Promise<ModelResponse> {
    this.retrievedProjectSources.clear();
    this.projectSourceReferences.clear();
    const userIndex = this.messages.length;
    this.messages.push({ role: "user", content: input });
    const turn: TurnRecord = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, sequence: this.journal.turns.length + 1, startedAt: new Date().toISOString(), status: "running", userMessageIndex: userIndex, attempts: [], actions: [] };
    (this.journal.turns as TurnRecord[]).push(turn);
    try { await this.persistState(); } catch (error) { this.messages.pop(); (this.journal.turns as TurnRecord[]).pop(); throw error; }
    await this.onSessionEvent?.({ type: "user", input });
    try { await this.compactIfNeeded(signal);
    const projection = buildContextProjection(this.messages, {
      maxTurns: this.context?.checkpoint ? this.contextRetainTurns : this.maxContextTurns,
      maxChars: this.maxContextChars,
    });
    const history = appendCheckpoint(projection, this.context?.checkpoint);
    let memoryContext: string | undefined;
    if (this.retrieveContext) {
      try {
        const retrieved = await this.retrieveContext(input, history);
        if (retrieved?.trim()) memoryContext = retrieved;
      } catch { this.onDiagnostic?.({ code: "MEMORY_RETRIEVAL_DEGRADED", component: "memory", severity: "debug" }); }
    }
    const phase = this.capabilities.length ? "tool-loop" as const : "legacy" as const;
    const request = { messages: composeRequestMessages(history, this.capabilities, phase, memoryContext ? { memory: memoryContext } : undefined) };
    let response: ModelResponse;
    if (this.capabilities.length && this.provider.generateWithTools) {
      response = await this.generateWithAvailableTools(request, signal);
    } else {
      response = await this.generateModel(request, false, signal);
    }
    if (signal.aborted) throw new RuntimeError({ code: "TURN_CANCELLED", recoverable: false, message: "当前回合已取消。" });
    const citations = validateAndCleanCitations(response.text, this.projectSourceReferences);
    if (citations.projectSources.length) {
      response = { ...response, text: citations.text, projectSources: citations.projectSources };
    } else {
      const { projectSources: _retrievedOnly, ...withoutSources } = response;
      response = { ...withoutSources, text: citations.text };
    }
    const text = response.text;
    if (!text.trim()) throw new Error("Provider returned empty text");
    const result = await this.commitResponse(response, signal);
    turn.status = response.outcome ?? "completed";
    turn.endedAt = new Date().toISOString();
    turn.assistantMessageIndex = this.messages.length - 1;
    await this.persistState(false);
    return result;
    } catch (error) {
      const cancelled = signal.aborted || (isRuntimeError(error) && error.code === "TURN_CANCELLED");
      turn.status = cancelled ? "cancelled" : "failed";
      turn.endedAt = new Date().toISOString();
      if (cancelled) turn.error = { code: "TURN_CANCELLED", recoverable: false, message: "当前回合已取消。" };
      else if (isRuntimeError(error)) turn.error = error.toRecord();
      await this.persistState(false);
      if (cancelled) throw new RuntimeError({ code: "TURN_CANCELLED", recoverable: false, message: "当前回合已取消。" });
      throw error;
    }
  }

  private async commitResponse(response: ModelResponse, signal: AbortSignal): Promise<ModelResponse> {
    if (signal.aborted) throw new RuntimeError({ code: "TURN_CANCELLED", recoverable: false, message: "当前回合已取消。" });
    await this.appendMessage({ role: "assistant", content: response.text });
    await this.onSessionEvent?.({ type: "assistant", text: response.text });
    try { await this.onTurnCommitted?.([...this.messages]); } catch { this.onDiagnostic?.({ code: "MEMORY_INDEX_FAILED", component: "memory", severity: "debug" }); }
    return response;
  }

  private async appendMessage(message: Message): Promise<void> {
    this.messages.push(message);
    try {
      await this.persistState();
    }
    catch (error) { this.messages.pop(); throw error; }
  }

  private async persistState(includeMessages = true): Promise<void> {
    const messages = [...this.messages];
    if (this.onSessionStateChanged) {
      await this.onSessionStateChanged({ messages, ...(this.context ? { context: this.context } : {}), journal: this.journal });
    } else if (includeMessages) {
      await this.onMessagesChanged?.(messages);
    }
  }

  private async compactIfNeeded(signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new RuntimeError({ code: "TURN_CANCELLED", recoverable: false, message: "当前回合已取消。" });
    if (!shouldCompact(this.messages, { maxTurns: this.maxContextTurns, maxChars: this.maxContextChars })) return;
    const previousCheckpoint = this.context?.checkpoint;
    const units = selectCompactionUnits(this.messages, this.contextRetainTurns, previousCheckpoint?.throughMessageIndex ?? -1);
    if (!units.length) return;
    const sourceMessages = units.flatMap(unit => unit.messages);
    const prompt = [
      "你是 Isla 的会话压缩器。请把历史对话压缩成可恢复的结构化检查点。",
      "只记录用户目标、已经完成的事实、明确决定、未完成事项、成功工具证据、话题关系和不确定信息。",
      "已经结束且没有后续影响的闲聊可以省略。不要编造事实，不要记录 API Key、令牌或思维链。",
      `必须严格使用以下七个 Markdown 标题：${COMPACTION_SECTIONS.map(section => `## ${section}`).join("、")}`,
      "历史 Tool Result 只能描述过去发生过什么，不能声称当前环境仍然如此。",
    ].join("\n");
    try {
      const response = await this.provider.generate({
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: renderMessagesForCompaction(sourceMessages, previousCheckpoint) },
        ],
      }, { signal });
      if (!response.text.trim() || !hasCompactionSections(response.text)) return;
      const checkpoint: SessionContext = {
        version: 1,
        checkpoint: {
          throughMessageIndex: units[units.length - 1]!.endIndex,
          createdAt: new Date().toISOString(),
          provider: this.provider.id,
          model: this.provider.model,
          content: response.text,
        },
      };
      const previous = this.context;
      this.context = checkpoint;
      try {
        await this.persistState();
      } catch {
        this.context = previous;
        return;
      }
      const turn = this.journal.turns.at(-1);
      if (turn) (turn.actions as TurnActionRecord[]).push({ type: "checkpoint", throughMessageIndex: checkpoint.checkpoint!.throughMessageIndex });
      await this.persistState(false);
      try { await this.onContextCompacted?.(checkpoint.checkpoint!); } catch { this.onDiagnostic?.({ code: "CHECKPOINT_CANDIDATE_FAILED", component: "memory", severity: "debug" }); }
    } catch {
      // Compression is derived maintenance. A failed compression must not block the turn.
      this.onDiagnostic?.({ code: "CHECKPOINT_FAILED", component: "context", severity: "debug" });
    }
  }

  private async appendSkippedToolResults(calls: readonly { id: string; name: string; arguments: string }[], reason: string, requestMessages?: Message[]): Promise<void> {
    for (const call of calls) {
      const skipped: ToolExecutionResult = { ok: false, code: "EXECUTION_FAILED", message: reason };
      await this.onSessionEvent?.({ type: "tool_call", callId: call.id, tool: call.name, arguments: call.arguments });
      await this.onSessionEvent?.({ type: "tool_result", callId: call.id, tool: call.name, result: skipped });
      const message = { role: "tool" as const, toolCallId: call.id, content: `[${skipped.code}] ${skipped.message}` };
      requestMessages?.push(message);
      await this.appendMessage(message);
    }
  }
}

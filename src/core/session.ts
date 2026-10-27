import type { ModelProvider, Message, ModelRequest, ModelResponse, ProjectSourceReference, ToolDefinition, ToolResponse } from "./types.js";
import type { ToolCapability, ToolExecutionResult } from "../tools/types.js";
import { createProjectFilesCapability } from "../tools/project-files.js";
import { ToolRegistry } from "../tools/registry.js";
import { ToolRuntime } from "../tools/runtime.js";
import type { ApprovalPolicy, ApprovalService } from "../approval/types.js";
import type { PermissionPreset } from "../approval/presets.js";
import { isRuntimeError, RuntimeError, type TurnCancelReason } from "./errors.js";
import type { ModelAttemptRecord, SessionJournal, TurnActionRecord, TurnRecord } from "./journal.js";
import type { TaskBrief } from "./agent-loop.js";
import { preflightAgentLoop } from './agent-loop-preflight.js';
import { migrateTaskBrief, summarizeTaskState, updateTaskState, type TaskStateV1 } from "./task-state.js";
import type { TaskContractV1 } from './task-contract.js';
import { validateWorkPlan, type WorkMode, type WorkModeStateV1, type WorkPlanV1 } from './work-plan.js';
import { evaluateCompletionGate, type CompletionRejectionReason } from "./completion-gate.js";
import { ModelStepRunner } from "./model-step.js";
import { RequestContextBuilder } from "./request-context.js";
import { createRequestSnapshot } from "./request-snapshot.js";
import { validateAndCleanCitations } from "./citations.js";
import { deriveVerificationStatus } from "./verification.js";
import { renderSkillContent } from "../skills/render.js";
import type { ModelStepEvent, SessionEvent, TurnPhase, TurnPhaseEvent } from "./events.js";
import {
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
import { buildRequestMessageProjection } from "./request-message-projection.js";
import { buildSessionPersistenceState, type SessionPersistenceState } from "./session-persistence.js";
import { mapTurnFailure } from "./turn-failure.js";
import { prepareToolResultMessage } from "./tool-result-message.js";
import { estimateRequestTokens, resolveTokenBudget, type TokenBudgetPolicy } from './token-budget.js';
import { LoopBudgetState, type LoopBudgetOptions } from './loop-budget.js';
import { evaluateToolProgress } from './progress-evaluator.js';
import { RESEARCH_EVIDENCE_REMINDER } from './research-policy.js';
import { runDecisionPhase } from './decision-phase.js';
import { observeToolResult } from './tool-observation.js';
import { buildEvidenceCards, renderEvidenceCards } from './evidence-cards.js';
import { createToolBatchExecutionInput } from './tool-batch-contract.js';
import type { UserQuestionService } from "../user-questions/types.js";
import { WorkspaceCheckpointStore } from '../checkpoints/workspace-checkpoint.js';
import { toolAllowedInMode } from '../tools/mode-policy.js';
export const DEFAULT_MAX_CONTEXT_TURNS = 20;
export const DEFAULT_MAX_TOOL_ROUNDS = 12;
type ModelRequestPhase = "legacy" | "agent_step";
export interface ChatSessionOptions {
  readonly systemPrompt?: string;
  readonly messages?: readonly Message[];
  readonly maxContextTurns?: number;
  readonly maxContextChars?: number;
  readonly contextRetainTurns?: number;
  readonly maxContextTokens?: number;
  readonly maxOutputTokens?: number;
  readonly contextReserveTokens?: number;
  readonly modelRetries?: number;
  readonly context?: SessionContext;
  readonly journal?: SessionJournal;
  readonly task?: TaskBrief | TaskStateV1;
  readonly taskContract?: TaskContractV1;
  readonly workPlan?: WorkPlanV1;
  readonly workMode?: WorkModeStateV1;
  readonly enablePlanAct?: boolean;
  readonly skillCatalog?: import("../sessions/store.js").StoredSkillCatalogV1;
  readonly capabilityActivation?: import("../capabilities/routing.js").CapabilityActivationStateV1;
  readonly onMessagesChanged?: (messages: readonly Message[]) => Promise<void>;
  readonly onSessionStateChanged?: (state: SessionPersistenceState) => Promise<void>;
  readonly onSessionEvent?: (event: SessionEvent) => Promise<void>;
  /** Lightweight observability hook; it must not affect turn execution. */
  readonly onTurnPhaseChanged?: (event: TurnPhaseEvent) => void;
  readonly onModelStepEvent?: (event: ModelStepEvent) => void;
  readonly projectRoot?: string;
  readonly onToolsUsed?: (tools: readonly string[]) => void;
  readonly onToolStarted?: (tool: string, callId: string, argumentsJson?: string) => void;
  readonly onToolFinished?: (tool: string, callId: string, result: ToolExecutionResult) => void;
  readonly enableTools?: boolean;
  readonly agentLoop?: boolean;
  readonly decisionPhase?: boolean;
  readonly loopBudget?: LoopBudgetOptions;
  readonly approvalPolicy?: ApprovalPolicy;
  readonly approvalService?: ApprovalService;
  readonly policyRules?: readonly import('../approval/policy.js').PolicyRuleV1[];
  readonly permissionPreset?: PermissionPreset;
  readonly retrieveContext?: (input: string, visibleMessages: readonly Message[]) => Promise<string | undefined>;
  readonly onTurnCommitted?: (messages: readonly Message[]) => Promise<void>;
  readonly onContextCompacted?: (checkpoint: ContextCheckpoint) => Promise<void>;
  readonly capabilities?: readonly ToolCapability[];
  readonly resolveCapabilities?: (input: string, step: number, signal: AbortSignal) => Promise<readonly ToolCapability[]>;
  readonly onDiagnostic?: (event: { readonly code: string; readonly component: string; readonly severity: 'warning' | 'error' | 'debug'; readonly detail?: string }) => void;
  readonly userQuestionService?: UserQuestionService;
  readonly agentLoopTimeoutMs?: number;
}

function sameTaskState(current: TaskStateV1, next: Omit<TaskStateV1, "revision" | "version" | "updatedAt">): boolean {
  return JSON.stringify({ goal: current.goal, status: current.status, constraints: current.constraints, assumptions: current.assumptions, openQuestions: current.openQuestions, steps: current.steps, blockers: current.blockers })
    === JSON.stringify({ goal: next.goal, status: next.status, constraints: next.constraints, assumptions: next.assumptions, openQuestions: next.openQuestions, steps: next.steps, blockers: next.blockers });
}
function optionsHasWorkContext(mode: WorkModeStateV1, plan: WorkPlanV1 | undefined): boolean { return mode.revision > 0 || plan !== undefined; }
export class ChatSession {
  private readonly messages: Message[];
  private readonly maxContextTurns: number;
  private readonly maxContextChars: number;
  private readonly contextRetainTurns: number;
  private readonly modelRetries: number;
  private readonly tokenBudget: TokenBudgetPolicy;
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
    this.modelRetries = options.modelRetries ?? 1;
    this.tokenBudget = resolveTokenBudget(options);
    if (!Number.isInteger(this.modelRetries) || this.modelRetries < 0 || this.modelRetries > 1) throw new Error("modelRetries must be 0 or 1");
    if (!Number.isInteger(this.contextRetainTurns) || this.contextRetainTurns <= 0)
      throw new Error("contextRetainTurns must be a positive integer");
    this.context = options.context;
    this.task = options.task;
    this.taskContract = options.taskContract;
    this.workPlan = options.workPlan;
    this.workMode = options.workMode ?? (options.enablePlanAct ? { version: 1, mode: 'plan', revision: 1, updatedAt: new Date().toISOString() } : { version: 1, mode: 'act', revision: 0, updatedAt: new Date().toISOString() });
    this.skillCatalog = options.skillCatalog;
    this.capabilityActivation = options.capabilityActivation;
    this.journal = options.journal ?? { version: 1, turns: [] };
    this.onMessagesChanged = options.onMessagesChanged;
    this.onSessionStateChanged = options.onSessionStateChanged;
    this.onSessionEvent = options.onSessionEvent;
    this.onTurnPhaseChanged = options.onTurnPhaseChanged;
    this.onModelStepEvent = options.onModelStepEvent;
    this.projectRoot = options.projectRoot;
    this.onToolsUsed = options.onToolsUsed;
    this.onToolStarted = options.onToolStarted;
    this.onToolFinished = options.onToolFinished;
    this.enableTools = options.enableTools ?? false;
    this.agentLoop = options.agentLoop ?? false;
    this.decisionPhase = options.decisionPhase ?? false;
    this.loopBudget = options.loopBudget ?? {};
    this.retrieveContext = options.retrieveContext;
    this.onTurnCommitted = options.onTurnCommitted;
    this.onContextCompacted = options.onContextCompacted;
    this.onDiagnostic = options.onDiagnostic;
    this.resolveCapabilities = options.resolveCapabilities;
    this.userQuestionService = options.userQuestionService;
    this.agentLoopTimeoutMs = options.agentLoopTimeoutMs ?? 600_000;
    // Explicit capabilities are the application path; retain the projectRoot fallback for direct legacy ChatSession callers.
    this.capabilities = this.enableTools && this.provider.generateWithTools && this.provider.capabilities?.toolCalling !== false
      ? (options.capabilities ?? (this.projectRoot ? [createProjectFilesCapability(this.projectRoot)] : []))
      : [];
    this.requestContextBuilder = new RequestContextBuilder({ capabilities: this.capabilities });
    this.toolRegistry = new ToolRegistry();
    for (const capability of this.capabilities) this.toolRegistry.registerCapability(capability);
    this.toolRuntime = new ToolRuntime(this.toolRegistry, {
      approvalPolicy: options.approvalPolicy,
      approvalService: options.approvalService,
      ...(options.policyRules ? { policyRules: options.policyRules } : {}),
      ...(options.projectRoot ? { workspace: options.projectRoot } : {}),
      permissionPreset: options.permissionPreset,
      ...(options.enablePlanAct || options.workMode || options.workPlan ? { mode: () => this.workMode.mode } : {}),
      ...(options.enablePlanAct || options.workMode || options.workPlan ? { plan: () => this.workPlan, actApproved: () => !!this.workPlan && this.workPlan.approvedRevision === this.workPlan.revision && this.workMode.actApprovedRevision === this.workPlan.revision } : {}),
    });
    this.checkpointStore = options.projectRoot && (options.enablePlanAct || options.workMode) ? new WorkspaceCheckpointStore(options.projectRoot) : undefined;
  }
  private readonly onMessagesChanged: ((messages: readonly Message[]) => Promise<void>) | undefined;
  private readonly skillCatalog: import("../sessions/store.js").StoredSkillCatalogV1 | undefined;
  private readonly capabilityActivation: import("../capabilities/routing.js").CapabilityActivationStateV1 | undefined;
  private readonly onSessionStateChanged: ((state: SessionPersistenceState) => Promise<void>) | undefined;
  private readonly journal: SessionJournal;
  private readonly onSessionEvent: ((event: SessionEvent) => Promise<void>) | undefined;
  private readonly onTurnPhaseChanged: ((event: TurnPhaseEvent) => void) | undefined;
  private readonly onModelStepEvent: ((event: ModelStepEvent) => void) | undefined;
  private readonly projectRoot: string | undefined;
  private readonly onToolsUsed: ((tools: readonly string[]) => void) | undefined;
  private readonly onToolStarted: ((tool: string, callId: string, argumentsJson?: string) => void) | undefined;
  private readonly onToolFinished: ((tool: string, callId: string, result: ToolExecutionResult) => void) | undefined;
  private readonly enableTools: boolean;
  private readonly agentLoop: boolean;
  private readonly decisionPhase: boolean;
  private readonly loopBudget: LoopBudgetOptions;
  private readonly retrieveContext: ((input: string, visibleMessages: readonly Message[]) => Promise<string | undefined>) | undefined;
  private readonly onTurnCommitted: ((messages: readonly Message[]) => Promise<void>) | undefined;
  private readonly onContextCompacted: ((checkpoint: ContextCheckpoint) => Promise<void>) | undefined;
  private readonly onDiagnostic: ((event: { readonly code: string; readonly component: string; readonly severity: 'warning' | 'error' | 'debug'; readonly detail?: string }) => void) | undefined;
  private readonly capabilities: readonly ToolCapability[];
  private readonly resolveCapabilities: ((input: string, step: number, signal: AbortSignal) => Promise<readonly ToolCapability[]>) | undefined;
  private readonly requestContextBuilder: RequestContextBuilder;
  private readonly toolRegistry: ToolRegistry;
  private readonly toolRuntime: ToolRuntime;
  private readonly checkpointStore: WorkspaceCheckpointStore | undefined;
  private readonly userQuestionService: UserQuestionService | undefined;
  private readonly agentLoopTimeoutMs: number;
  private activeTurn: { readonly controller: AbortController; readonly promise: Promise<ModelResponse> } | undefined;
  private closed = false;
  private readonly retrievedProjectSources = new Set<string>();
  private readonly projectSourceReferences = new Map<string, ProjectSourceReference>();
  private task: TaskBrief | TaskStateV1 | undefined;
  private taskContract: TaskContractV1 | undefined;
  private workPlan: WorkPlanV1 | undefined;
  private workMode: WorkModeStateV1;
  private turnPhase: TurnPhase = "idle";

  private setTurnPhase(phase: TurnPhase, details: Omit<TurnPhaseEvent, "phase"> = {}): void {
    this.turnPhase = phase;
    try { this.onTurnPhaseChanged?.({ phase, ...details }); } catch { /* observability must never break a turn */ }
  }

  get currentTurnPhase(): TurnPhase { return this.turnPhase; }

  get taskState(): TaskStateV1 | undefined {
    if (!this.task) return undefined;
    return "version" in this.task ? this.task : migrateTaskBrief(this.task, this.messages);
  }

  get currentWorkPlan(): WorkPlanV1 | undefined { return this.workPlan; }
  get currentWorkMode(): WorkModeStateV1 { return this.workMode; }
  async listWorkspaceCheckpoints() { return this.checkpointStore?.list() ?? []; }
  async previewWorkspaceCheckpoint(id: string) { if (!this.checkpointStore) throw new Error('CHECKPOINT_UNAVAILABLE'); return this.checkpointStore.preview(id); }
  async restoreWorkspaceCheckpoint(id: string, approved: boolean) { if (!this.checkpointStore) throw new Error('CHECKPOINT_UNAVAILABLE'); await this.checkpointStore.restore(id, approved); }
  async setWorkMode(mode: WorkMode, explicitUserApproval = false): Promise<void> {
    if (mode === 'act' && (!explicitUserApproval || !this.workPlan)) throw new Error('ACT_REQUIRES_EXPLICIT_PLAN_APPROVAL');
    if (mode === 'act') {
      this.workPlan = validateWorkPlan({ ...this.workPlan!, approvedRevision: this.workPlan!.revision });
      this.workMode = { version: 1, mode, revision: this.workMode.revision + 1, actApprovedRevision: this.workPlan.revision, updatedAt: new Date().toISOString() };
    } else this.workMode = { version: 1, mode, revision: this.workMode.revision + 1, updatedAt: new Date().toISOString() };
    await this.persistState();
  }
  async updateWorkPlan(plan: WorkPlanV1, expectedRevision: number): Promise<void> {
    if ((this.workPlan?.revision ?? 0) !== expectedRevision) throw new Error('PLAN_REVISION_CONFLICT');
    const next = validateWorkPlan({ ...plan, revision: expectedRevision + 1, planId: this.workPlan?.planId ?? plan.planId, updatedAt: new Date().toISOString() });
    this.workPlan = next;
    this.workMode = { version: 1, mode: 'plan', revision: this.workMode.revision + 1, updatedAt: new Date().toISOString() };
    await this.persistState();
    await this.onSessionEvent?.({ type: 'plan_updated', plan: next });
  }

  get skillCatalogSnapshot(): import("../sessions/store.js").StoredSkillCatalogV1 | undefined { return this.skillCatalog; }

  get verificationStatus() {
    return deriveVerificationStatus(this.journal);
  }

  async send(input: string): Promise<ModelResponse> {
    if (this.closed) throw new RuntimeError({ code: "UNKNOWN", recoverable: false, message: "当前 Agent 已关闭。" });
    if (this.activeTurn) throw new RuntimeError({ code: "UNKNOWN", recoverable: true, message: "当前回合仍在执行。" });
    const controller = new AbortController();
    const promise = this.runTurn(input, controller.signal).finally(() => {
      if (this.activeTurn?.controller === controller) this.activeTurn = undefined;
    });
    this.activeTurn = { controller, promise };
    return promise;
  }

  async sendWithSkill(input: { readonly name: string; readonly userInput?: string; readonly content: string }): Promise<ModelResponse> {
    if (this.closed) throw new RuntimeError({ code: "UNKNOWN", recoverable: false, message: "当前 Agent 已关闭。" });
    if (this.activeTurn) throw new RuntimeError({ code: "UNKNOWN", recoverable: true, message: "当前回合仍在执行。" });
    const controller = new AbortController();
    const promise = this.runTurn(input.userInput?.trim() || `请使用 Skill ${input.name} 处理当前请求。`, controller.signal, input).finally(() => {
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

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.cancelActiveTurn({ kind: "shutdown" });
    await this.whenIdle();
  }

  private async generateWithAvailableTools(request: { readonly messages: readonly Message[] }, signal: AbortSignal, requiredTool?: string): Promise<ModelResponse> {
    const provider = this.provider;
    if (!this.enableTools || !provider.generateWithTools) return provider.generate(request, { signal });
    let current = request.messages;
    const evidence: string[] = [];
    const searchResultUrls = new Set<string>();
    const failures = new Map<string, number>();
    const completionRejections: CompletionRejectionReason[] = [];
    const successfulWrites = new Set<string>();
    let tools: readonly ToolDefinition[] = this.selectToolDefinitions(current.map(message => message.content).join("\n"));
    const loopBudget = new LoopBudgetState(this.loopBudget);
    const loopStartedAt = Date.now();
    let wrapUpSent = false;
    let readOnlyObservationRounds = 0;
    this.setTurnPhase("preflight");
    const preflight = preflightAgentLoop({ messages: current, tools, maxInputTokens: this.tokenBudget.maxInputTokens });
    if (preflight.researchGap) return { text: preflight.researchGap, outcome: 'blocked', model: provider.model };
    if (preflight.trimmed) {
      current = preflight.messages;
      this.onDiagnostic?.({ code: "AGENT_LOOP_CONTEXT_TRIMMED", component: "agent_loop.preflight", severity: "warning", detail: `messages=${current.length}` });
    }
    const researchRequired = preflight.researchRequired;
    for (let round = 0; round < loopBudget.currentBudget; round += 1) {
      this.setTurnPhase("model", { round });
      if (Date.now() - loopStartedAt >= this.agentLoopTimeoutMs) {
        const turn = this.journal.turns.at(-1);
        if (turn) {
          (turn.actions as TurnActionRecord[]).push({ type: "checkpoint", throughMessageIndex: this.messages.length - 1 });
          (turn.actions as TurnActionRecord[]).push({ type: "loop_budget", step: round, event: "stop", budget: loopBudget.currentBudget, reason: "wall_clock_timeout" });
        }
        return { text: "Agent Loop 达到时间上限，已暂停执行。", outcome: "blocked", model: provider.model };
      }
      if (this.resolveCapabilities) {
        const dynamicCapabilities = await this.resolveCapabilities(current.map(message => message.content).join("\n"), round, signal);
        for (const capability of dynamicCapabilities) this.toolRegistry.registerCapabilityIfAbsent(capability);
        tools = this.selectToolDefinitions(current.map(message => message.content).join("\n"));
        const turn = this.journal.turns.at(-1);
        if (turn) {
          const capabilityIds = dynamicCapabilities.map(capability => capability.id).sort();
          const schemaBytes = tools.reduce((total, tool) => total + Buffer.byteLength(JSON.stringify(tool.parameters), 'utf8'), 0);
          const hash = capabilityIds.join('|') + ':' + tools.map(tool => tool.name).join('|');
          (turn.actions as TurnActionRecord[]).push({ type: 'capability_snapshot', step: round, capabilityIds, toolCount: tools.length, schemaBytes, hash });
        }
      }
      const mustSearch = requiredTool === "web_search" && !evidence.some(item => item.startsWith("web_search:"));
      const mustFetch = requiredTool === "web_search" && !mustSearch && !evidence.some(item => item.startsWith("web_fetch:")) && tools.some(tool => tool.name === "web_fetch");
      const requiredToolChoice = mustSearch ? requiredTool : mustFetch ? "web_fetch" : undefined;
      const loopRequest = { messages: current, tools, ...(requiredToolChoice ? { toolChoice: { name: requiredToolChoice } as const } : {}) };
      const loopEstimate = estimateRequestTokens(loopRequest);
      if (loopEstimate > Math.floor(this.tokenBudget.maxInputTokens * 0.82)) {
        this.setTurnPhase("compacting", { round, detail: `estimatedTokens=${loopEstimate}` });
        const before = this.context?.checkpoint?.throughMessageIndex ?? -1;
        await this.compactIfNeeded(signal, true);
        const after = this.context?.checkpoint?.throughMessageIndex ?? -1;
        if (after > before) {
          current = this.requestContextBuilder.build(this.messages, "agent_step", undefined, this.task).messages;
          this.onDiagnostic?.({ code: "AGENT_LOOP_CONTEXT_COMPACTED", component: "context", severity: "debug", detail: `estimated=${loopEstimate};through=${after}` });
        }
        const postCompaction = preflightAgentLoop({ messages: current, tools, maxInputTokens: this.tokenBudget.maxInputTokens });
        if (postCompaction.trimmed) {
          current = postCompaction.messages;
          this.onDiagnostic?.({ code: "AGENT_LOOP_CONTEXT_TRIMMED", component: "context", severity: "warning", detail: `estimated=${loopEstimate};messages=${current.length}` });
        }
      }
      if (loopEstimate > this.tokenBudget.maxInputTokens && readOnlyObservationRounds >= 2 && evidence.length > 0) {
        const bounded = current.filter(message => message.role === 'user' || (message.role === 'system' && message.content.includes('[[evidence_cards]]'))).slice(-24);
        const boundedPrompt = { role: 'system' as const, content: '上下文预算不足，必须立即停止工具调用并基于下方已持久化证据卡片作简短报告。不要补充未被证据直接支持的能力结论；每条当前事实标注 [证据: 路径或工具名]，其余放入未验证。' };
        let boundedResponse = await this.generateModel({ messages: [...bounded, boundedPrompt], tools: [] }, false, signal, 'agent_step');
        if (/tool_use|tool_call|read_text_file|list_dir|```json/iu.test(boundedResponse.text)) {
          boundedResponse = await this.generateModel({ messages: [...bounded, boundedPrompt, { role: 'system', content: '上一版输出错误地模拟了工具调用。现在只输出中文自然语言报告，不要 JSON、代码块、tool_use、tool_call 或任何新的工具请求。' }], tools: [] }, false, signal, 'agent_step');
        }
        if (boundedResponse.text.trim()) return { ...boundedResponse, evidence, ...(this.projectSourceReferences.size ? { projectSources: [...this.projectSourceReferences.values()] } : {}) };
      }
      this.setTurnPhase("model", { round });
      const response = await this.generateModel({ messages: current, tools, ...(requiredToolChoice ? { toolChoice: { name: requiredToolChoice } } : {}) }, true, signal, "agent_step");
      if (!response.toolCalls?.length && !mustSearch && !mustFetch) {
        const verificationStatus = deriveVerificationStatus(this.journal);
        if (verificationStatus === "not_run" && !completionRejections.includes("verification_missing_after_mutation")) {
          completionRejections.push("verification_missing_after_mutation");
          current = [...current, { role: "system", content: "[completion_rejected] 当前存在修改但尚未验证。必须先运行适用验证，再报告完成。" }];
          continue;
        }
        const hasExternalEvidence = evidence.some(item => /^(?:web_search|web_fetch|browser_read|browser_links):/u.test(item));
        if (researchRequired && !hasExternalEvidence) {
          const canDiscoverSources = tools.some(tool => tool.name === "web_search" || tool.name === "browser_open");
          if (!canDiscoverSources) return { text: "当前 Profile 没有可用的外部来源发现能力，无法把这项研究描述为已联网核实。", outcome: "blocked", model: response.model ?? provider.model };
          current = [...current, { role: "system", content: RESEARCH_EVIDENCE_REMINDER }];
          continue;
        }
        const toolCallIds = current.flatMap(message => message.toolCalls?.map(call => call.id) ?? []);
        const toolResultIds = current.filter(message => message.role === "tool" && message.toolCallId).map(message => message.toolCallId!);
        const completion = evaluateCompletionGate({
          toolCallIds,
          toolResultIds,
          verificationStatus: deriveVerificationStatus(this.journal),
          priorRejections: completionRejections,
          ...(this.taskContract ? { contract: this.taskContract } : {}),
        });
        if (!completion.accepted) {
          completionRejections.push(completion.reason);
          this.onDiagnostic?.({ code: "COMPLETION_REJECTED", component: "agent_loop", severity: "warning", detail: `reason=${completion.reason}` });
          const observation = { role: "system" as const, content: completion.observation };
          current = [...current, observation];
          if (completion.terminal) return { text: "当前回合无法安全完成，已停止继续执行。", outcome: "blocked", model: response.model ?? provider.model };
          continue;
        }
        return { ...response, ...(evidence.length ? { evidence } : {}), ...(this.projectSourceReferences.size ? { projectSources: [...this.projectSourceReferences.values()] } : {}) };
      }
      if (!response.toolCalls?.length) return { text: mustSearch ? "未能发起必要的 Web Search。" : "未能读取必要的 Web Search 来源。", outcome: "blocked", evidence, model: response.model ?? provider.model };
      const batchInput = createToolBatchExecutionInput(response, round);
      const assistantToolMessage = { role: "assistant" as const, content: response.assistantContent ?? "", toolCalls: batchInput.calls };
      const next = [...current, assistantToolMessage];
      await this.appendMessage(assistantToolMessage);
      const batch = await this.executeToolBatch({ calls: batchInput.calls, round, responseModel: response.model ?? provider.model, signal, next, evidence, searchResultUrls, failures, successfulWrites, loopBudget, readOnlyObservationRounds });
      current = batch.next;
      readOnlyObservationRounds = batch.readOnlyObservationRounds;
      if (batch.response) return batch.response;
      if (readOnlyObservationRounds >= 6) {
        const turn = this.journal.turns.at(-1);
        if (turn) (turn.actions as TurnActionRecord[]).push({ type: "loop_budget", step: round, event: "stop", budget: loopBudget.currentBudget, reason: "read_only_observation_limit" });
        const synthesisMessages = [...current, { role: "system" as const, content: "已获得足够的只读证据。现在必须停止调用工具，直接整理最终报告：区分当前代码事实、历史文档结论、未验证推断和结论；不要声称未执行的检查。证据绑定规则：每个‘当前代码事实’必须能对应本轮成功读取的具体文件内容或工具结果，并在同一句末尾写 [证据: <实际路径或工具名>]；只有能逐字支持该事实时才可写入当前事实，否则移到‘未验证’。不能把依赖、目录名、存在某个模块或历史文档推断成运行时能力，不能使用‘完全成熟’‘无缝接入’等夸大结论；未读取的 transport/provider 实现、实际网络状态、代理是否生效一律标为未验证。只有本轮成功执行的 project_search 才允许输出 project source marker；不得复用历史会话中的 source marker，也不要为了显得有引用而编造标记。报告控制在 800 字以内，并以完整结论句结束。" }];
        let synthesis = await this.generateModel({ messages: synthesisMessages, tools: [] }, false, signal, "agent_step");
        if (synthesis.text.length > 160 && !/[。！？.!?）)\]】」』`}]$/u.test(synthesis.text.trim())) {
          synthesis = await this.generateModel({ messages: [...synthesisMessages, { role: "system", content: "上一版回答疑似被截断。请重新输出一份完整、简洁、以结论句收尾的报告，不要调用工具。" }], tools: [] }, false, signal, "agent_step");
        }
        if (synthesis.text.trim()) return { ...synthesis, evidence, ...(this.projectSourceReferences.size ? { projectSources: [...this.projectSourceReferences.values()] } : {}) };
        return { text: `只读观察连续多次没有产生新的证据，已停止继续扫描。当前已记录 ${evidence.length} 条证据、${this.projectSourceReferences.size} 个项目来源。`, outcome: "blocked", model: provider.model };
      }
      const verificationStatus = deriveVerificationStatus(this.journal);
      const verificationObservation = verificationStatus === "not_applicable" ? undefined : { role: "system" as const, content: `当前工作区验证状态（仅供本步骤判断，不是用户事实）：${verificationStatus}` };
      const lastToolIndex = next.findLastIndex(message => message.role === "tool");
      const observations = [verificationObservation].filter((item): item is { readonly role: "system"; readonly content: string } => Boolean(item));
      current = observations.length === 0 ? next : lastToolIndex >= 0
        ? [...next.slice(0, lastToolIndex), ...observations, ...next.slice(lastToolIndex)]
        : [...next, ...observations];
      if (round + 1 >= loopBudget.currentBudget - 2 && loopBudget.tryExtend()) {
        const turn = this.journal.turns.at(-1);
        if (turn) (turn.actions as TurnActionRecord[]).push({ type: "loop_budget", step: round, event: "auto_extend", budget: loopBudget.currentBudget });
        this.onDiagnostic?.({ code: 'LOOP_BUDGET_EXTENDED', component: 'agent_loop', severity: 'debug', detail: `budget=${loopBudget.currentBudget}` });
      } else if (round + 1 >= loopBudget.currentBudget - 2 && !loopBudget.shouldStop() && !loopBudget.hardStopReached()) {
        if (!wrapUpSent) {
          current = [...current, { role: "system", content: "即将达到当前 Agent Loop 自动预算。请先收束已完成工作；若仍有明确未完成目标，请改变策略并说明下一步，不要重复最近动作。" }];
          wrapUpSent = true;
          this.onDiagnostic?.({ code: "LOOP_WRAP_UP", component: "agent_loop", severity: "debug" });
        }
        const approved = await this.askForLoopContinuation(loopBudget, signal);
        if (!approved) {
          const turn = this.journal.turns.at(-1);
          if (turn) (turn.actions as TurnActionRecord[]).push({ type: "loop_budget", step: round, event: "stop", budget: loopBudget.currentBudget, reason: "user_or_interaction_stop" });
          return { text: "工具调用预算已达到自动上限，已暂停执行。", outcome: "blocked", model: provider.model };
        }
        const turn = this.journal.turns.at(-1);
        if (turn) (turn.actions as TurnActionRecord[]).push({ type: "loop_budget", step: round, event: "user_extend", budget: loopBudget.currentBudget });
      }
    }
    const turn = this.journal.turns.at(-1);
    if (turn) {
      (turn.actions as TurnActionRecord[]).push({ type: "checkpoint", throughMessageIndex: this.messages.length - 1 });
      (turn.actions as TurnActionRecord[]).push({ type: "loop_budget", step: loopBudget.currentBudget, event: "stop", budget: loopBudget.currentBudget, reason: "hard_limit" });
    }
    await this.persistState(false);
    return { text: `工具调用达到本轮硬上限，当前进度已保存，可在下一轮继续。已记录 ${evidence.length} 条证据、${this.projectSourceReferences.size} 个项目来源；下一轮将从 checkpoint 继续，避免重复已完成的观察。`, outcome: "blocked", model: provider.model };
  }

  private async executeToolBatch(input: {
    readonly calls: readonly import('./types.js').ToolCall[];
    readonly round: number;
    readonly responseModel?: string;
    readonly signal: AbortSignal;
    readonly next: Message[];
    readonly evidence: string[];
    readonly searchResultUrls: Set<string>;
    readonly failures: Map<string, number>;
    readonly successfulWrites: Set<string>;
    readonly loopBudget: LoopBudgetState;
    readonly readOnlyObservationRounds: number;
  }): Promise<{ readonly next: Message[]; readonly readOnlyObservationRounds: number; readonly response?: ModelResponse }> {
    let readOnlyObservationRounds = input.readOnlyObservationRounds;
    const controlNames = new Set(['submit_result', 'report_blocked', 'propose_replan']);
    const deferredControlCalls = input.calls.length > 1 ? input.calls.filter(call => controlNames.has(call.name)) : [];
    const executableCalls = deferredControlCalls.length ? input.calls.filter(call => !controlNames.has(call.name)) : input.calls;
    this.setTurnPhase("executing_tools", { round: input.round });
    for (let callIndex = 0; callIndex < executableCalls.length; callIndex += 1) {
      const call = executableCalls[callIndex]!;
      this.setTurnPhase("executing_tools", { round: input.round, tool: call.name });
      const writeKey = `${call.name}:${call.arguments}`;
      await this.onSessionEvent?.({ type: "tool_call", callId: call.id, tool: call.name, arguments: call.arguments });
      this.onToolStarted?.(call.name, call.id, call.arguments);
      if ((call.name === "write_text_file" || call.name === "edit_text_file") && input.successfulWrites.has(writeKey)) {
        const duplicateResult: ToolExecutionResult = { ok: true, content: "相同写入已在本轮成功执行，未重复写入。" };
        this.onToolFinished?.(call.name, call.id, duplicateResult);
        await this.onSessionEvent?.({ type: "tool_result", callId: call.id, tool: call.name, result: duplicateResult });
        await this.appendMessage({ role: "tool", toolCallId: call.id, content: duplicateResult.content });
        await this.appendSkippedToolResults([...executableCalls.slice(callIndex + 1), ...deferredControlCalls], "相同写入已完成，本批次其余调用未执行。", input.next);
        return { next: input.next, readOnlyObservationRounds, response: { text: "写入已完成，已停止重复写入。", outcome: "completed", evidence: input.evidence, ...(input.responseModel ? { model: input.responseModel } : {}) } };
      }
      let terminalResponse: ModelResponse | undefined;
      let execution: ToolExecutionResult = { ok: false, code: "EXECUTION_FAILED", message: "Tool execution interrupted" };
      try {
        if (this.checkpointStore && (call.name === 'write_text_file' || call.name === 'edit_text_file' || (this.workMode.mode === 'act' && ['run_command','exec_start'].includes(call.name)))) {
          const checkpoint = await this.checkpointStore.create();
          await this.onSessionEvent?.({ type: 'workspace_checkpoint_created', checkpointId: checkpoint.id, createdAt: checkpoint.createdAt });
        }
        execution = await this.toolRuntime.execute(call, { signal: input.signal, webFetchAllowedUrls: [...input.searchResultUrls] });
        const observation = observeToolResult(call.name, execution);
        input.evidence.push(...observation.evidence);
        for (const url of observation.sourceUrls) input.searchResultUrls.add(url);
        if (execution.ok && execution.details?.type === "project_search") {
          const sourceIds = [...new Set(observation.projectSources.map(source => source.id))].sort();
          const references = new Map<string, ProjectSourceReference>();
          for (const source of observation.projectSources) {
            const existing = this.projectSourceReferences.get(source.id);
            if (existing && (existing.path !== source.reference.path || existing.startLine !== source.reference.startLine)) {
              terminalResponse = { text: "项目来源身份冲突，已停止本轮执行。", outcome: "blocked", evidence: input.evidence, ...(this.projectSourceReferences.size ? { projectSources: [...this.projectSourceReferences.values()] } : {}), ...(input.responseModel ? { model: input.responseModel } : {}) };
              continue;
            }
            references.set(source.id, source.reference);
          }
          for (const sourceId of sourceIds) {
            this.retrievedProjectSources.add(sourceId);
            const reference = references.get(sourceId);
            if (reference) this.projectSourceReferences.set(sourceId, reference);
          }
          const turn = this.journal.turns.at(-1);
          if (turn && sourceIds.length) (turn.actions as TurnActionRecord[]).push({ type: "project_retrieval", sourceIds, truncated: execution.details.truncated });
        }
        if (execution.ok && (call.name === "write_text_file" || call.name === "edit_text_file")) input.successfulWrites.add(writeKey);
        const actionTurn = this.journal.turns.at(-1);
        if (actionTurn && execution.ok && (call.name === "write_text_file" || call.name === "edit_text_file")) (actionTurn.actions as TurnActionRecord[]).push({ type: "workspace_mutation", step: input.round, tool: call.name });
        if (execution.ok && execution.details?.type === "task_state_update") {
          try {
            const currentTask = this.task && "version" in this.task ? this.task : this.task ? migrateTaskBrief(this.task, this.messages) : undefined;
            const nextState = { ...execution.details.state, steps: execution.details.state.steps.map((step, index) => ({ ...step, id: step.id ?? `step-${index + 1}` })) };
            this.task = currentTask && sameTaskState(currentTask, nextState) ? currentTask : updateTaskState(currentTask, nextState, currentTask?.revision ?? 0, this.messages);
            const summary = summarizeTaskState(this.task);
            execution = { ...execution, content: `任务状态已保存：${summary.status}，步骤 ${summary.completedSteps}/${summary.totalSteps}，阻塞 ${summary.blockerCount}。` };
          } catch (error) { execution = { ok: false, code: "EXECUTION_FAILED", message: error instanceof Error ? error.message : "TaskState update failed" }; }
        }
        if (execution.ok && execution.details?.type === 'work_plan_update') {
          try { await this.updateWorkPlan(execution.details.plan, this.workPlan?.revision ?? 0); execution = { ...execution, content: `Plan 已保存，revision=${this.workPlan!.revision}。用户仍需显式批准后才能进入 Act。` }; }
          catch (error) { execution = { ok: false, code: 'EXECUTION_FAILED', message: error instanceof Error ? error.message : 'PLAN_UPDATE_FAILED' }; }
        }
        if (execution.ok && execution.details?.type === "settlement_proposal") {
          const proposal = execution.details.proposal;
          if (proposal.kind === 'submit' && proposal.text?.trim()) {
            // The model may only submit a candidate. Runtime owns the terminal
            // outcome; v0.6.1 accepts a non-empty candidate after tool results
            // have been observed and never trusts a model-supplied status.
            terminalResponse = {
              text: proposal.text.trim(),
              outcome: 'completed',
              ...(input.evidence.length ? { evidence: input.evidence } : {}),
              ...(this.projectSourceReferences.size ? { projectSources: [...this.projectSourceReferences.values()] } : {}),
              ...(input.responseModel ? { model: input.responseModel } : {}),
            };
          } else if (proposal.kind === 'blocked' && proposal.reason?.trim() && proposal.attempts?.length) {
            const detail = proposal.needsUser ? `${proposal.reason.trim()}；需要用户：${proposal.needsUser.trim()}` : proposal.reason.trim();
            terminalResponse = { text: `当前无法安全完成：${detail}`, outcome: 'blocked', ...(input.evidence.length ? { evidence: input.evidence } : {}), ...(input.responseModel ? { model: input.responseModel } : {}) };
          } else {
            execution = { ok: false, code: 'EXECUTION_FAILED', message: 'CONTROL_SETTLEMENT_INVALID' };
          }
        }
        if (execution.ok && execution.details?.type === "replan_proposal") {
          const proposal = execution.details;
          const currentRevision = input.round;
          if (proposal.strategyRevision <= currentRevision) {
            execution = { ok: false, code: 'EXECUTION_FAILED', message: 'REPLAN_REVISION_NOT_NEW' };
          } else {
            execution = { ...execution, content: `重规划已记录（策略 ${proposal.strategyRevision}）：${proposal.summary}；下一步：${proposal.nextStep}` };
          }
        }
        if (actionTurn && execution.ok && execution.details?.type === "command_execution" && execution.details.purpose === "verification") (actionTurn.actions as TurnActionRecord[]).push({ type: "verification", step: input.round, outcome: execution.details.exitCode === 0 && !execution.details.timedOut && !execution.details.aborted && execution.details.signal === null ? "passed" : "failed" });
        if (!execution.ok) {
          if (execution.code === "USER_REJECTED") terminalResponse = { text: "用户拒绝了工具调用，已停止本轮执行。", outcome: "blocked", evidence: input.evidence, ...(this.projectSourceReferences.size ? { projectSources: [...this.projectSourceReferences.values()] } : {}), ...(input.responseModel ? { model: input.responseModel } : {}) };
          const key = `${call.name}:${call.arguments}:${execution.code}`;
          const count = (input.failures.get(key) ?? 0) + 1;
          input.failures.set(key, count);
          if (count >= 2) terminalResponse = { text: "工具调用连续失败，已停止自动重试。", outcome: "blocked", evidence: input.evidence, ...(this.projectSourceReferences.size ? { projectSources: [...this.projectSourceReferences.values()] } : {}), ...(input.responseModel ? { model: input.responseModel } : {}) };
        }
      } finally {
        const turn = this.journal.turns.at(-1);
        if (turn) (turn.actions as TurnActionRecord[]).push({ type: "tool", step: input.round, callId: call.id, tool: call.name, ok: execution.ok, ...(!execution.ok ? { code: execution.code } : {}) });
        await this.persistState(false);
        this.onToolFinished?.(call.name, call.id, execution);
        await this.onSessionEvent?.({ type: "tool_result", callId: call.id, tool: call.name, result: execution });
      }
      if (!execution.ok && execution.code === "TURN_CANCELLED") throw new RuntimeError({ code: "TURN_CANCELLED", recoverable: false, message: "当前回合已取消。" });
      this.onToolsUsed?.([call.name]);
      const preparedResult = prepareToolResultMessage(call.id, execution);
      this.setTurnPhase("observing", { round: input.round, tool: call.name });
      if (preparedResult.pruning.pruned) this.onDiagnostic?.({ code: "TOOL_RESULT_PRUNED", component: "context", severity: "debug", detail: `tool=${call.name};originalChars=${preparedResult.pruning.originalChars};retainedChars=${preparedResult.pruning.retainedChars}` });
      const evidenceCards = buildEvidenceCards(call, execution);
      const renderedCards = renderEvidenceCards(evidenceCards);
      input.next.push(preparedResult.message);
      await this.appendMessage(preparedResult.message);
      if (renderedCards) {
        // Persist cards as canonical session facts without placing a system
        // message between an assistant tool call and its matching tool result
        // in the immediate provider request.
        await this.appendMessage({ role: 'system', content: renderedCards });
      }
      if (terminalResponse) {
        await this.appendSkippedToolResults([...executableCalls.slice(callIndex + 1), ...deferredControlCalls], "本批次前序调用已使执行停止。", input.next);
        return { next: input.next, readOnlyObservationRounds, response: terminalResponse };
      }
      const progress = evaluateToolProgress(call.name, execution);
      if (progress.kind === 'observation' && execution.ok) readOnlyObservationRounds += 1;
      else if (progress.changed || progress.kind === 'evidence' || progress.kind === 'task_update' || progress.kind === 'verification') readOnlyObservationRounds = 0;
      input.loopBudget.record({ action: `${call.name}:${call.arguments}`, result: execution.ok ? `${progress.kind}:${execution.content.slice(0, 500)}` : execution.message, changed: progress.changed, ...(execution.ok ? {} : { errorCode: execution.code }) });
      if (execution.ok && input.loopBudget.hasRepeatedTool(call.name)) {
        const turn = this.journal.turns.at(-1);
        if (turn) (turn.actions as TurnActionRecord[]).push({ type: "loop_budget", step: input.round, event: "stop", budget: input.loopBudget.currentBudget, reason: `repeated_observation:${call.name}` });
        return { next: input.next, readOnlyObservationRounds, response: { text: `工具 ${call.name} 连续进行了多次无进展检查，已停止重复执行。`, outcome: "blocked", evidence: input.evidence, ...(input.responseModel ? { model: input.responseModel } : {}) } };
      }
      if (!execution.ok && input.loopBudget.hasRepeatedFailure()) {
        const turn = this.journal.turns.at(-1);
        if (turn) (turn.actions as TurnActionRecord[]).push({ type: "loop_budget", step: input.round, event: "stop", budget: input.loopBudget.currentBudget, reason: `repeated_failure:${call.name}:${execution.code}` });
        return { next: input.next, readOnlyObservationRounds, response: { text: `工具 ${call.name} 连续失败，错误类型为 ${execution.code}，原因：${execution.message.slice(0, 240)}。已停止重复重试。`, outcome: "blocked", ...(input.responseModel ? { model: input.responseModel } : {}) } };
      }
    }
    if (deferredControlCalls.length) await this.appendSkippedToolResults(deferredControlCalls, "控制提案与普通工具混合，本轮未调度；请基于最新 Tool Result 在下一步重新提交。", input.next);
    return { next: input.next, readOnlyObservationRounds };
  }

  private async askForLoopContinuation(loopBudget: LoopBudgetState, signal: AbortSignal): Promise<boolean> {
    if (!this.userQuestionService) return false;
    try {
      const result = await this.userQuestionService.ask({ questions: [{ id: "agent_loop_continue", header: "继续执行", question: `Agent Loop 已使用约 ${loopBudget.currentBudget} 步，近期仍有进展。是否再增加 8 步？`, options: [{ label: "继续", description: "增加一段有界预算" }, { label: "停止", description: "暂停并把当前结果交给用户" }] }] }, { signal });
      const selected = result.answers.find(item => item.id === "agent_loop_continue")?.selected[0]?.trim().toLowerCase();
      const approved = selected === "继续" || selected === "continue" || selected === "yes" || selected === "y";
      if (approved && loopBudget.extendAfterApproval()) {
        this.onDiagnostic?.({ code: 'LOOP_BUDGET_EXTENDED_BY_USER', component: 'agent_loop', severity: 'debug', detail: `budget=${loopBudget.currentBudget}` });
        return true;
      }
    } catch { /* treat unavailable interaction as a safe stop */ }
    return false;
  }

  private generateModel(request: ModelRequest & { readonly tools: readonly ToolDefinition[] }, withTools: true, signal: AbortSignal, phase?: ModelRequestPhase): Promise<ToolResponse>;
  private generateModel(request: ModelRequest, withTools: false, signal: AbortSignal, phase?: ModelRequestPhase): Promise<ModelResponse>;
  private async generateModel(request: ModelRequest, withTools: boolean, signal: AbortSignal, phase: ModelRequestPhase = "legacy"): Promise<ModelResponse | ToolResponse> {
    request = { ...request, maxCompletionTokens: request.maxCompletionTokens ?? this.tokenBudget.maxOutputTokens };
    this.assertTokenBudget(request);
    const turn = this.journal.turns.at(-1);
    const step = turn?.attempts.length ?? 0;
    for (let attempt = 0; ; attempt += 1) {
      const record: ModelAttemptRecord = { attempt: attempt + 1, step: turn?.attempts.length ?? 0, startedAt: new Date().toISOString(), status: "running", request: createRequestSnapshot(request, this.provider.id, this.provider.model, "v0.2.7.4", [...this.retrievedProjectSources].sort(), phase) };
      if (turn) { (turn.attempts as ModelAttemptRecord[]).push(record); await this.persistState(false); }
      try {
        if (signal.aborted) throw new RuntimeError({ code: "TURN_CANCELLED", recoverable: false, message: "当前回合已取消。" });
        const response = await new ModelStepRunner().run(request, { provider: this.provider, step, attempt: attempt + 1, withTools, signal, ...(this.onModelStepEvent ? { onEvent: this.onModelStepEvent } : {}) });
        record.status = "succeeded"; record.endedAt = new Date().toISOString(); await this.persistState(false);
        this.onDiagnostic?.({ code: "MODEL_REQUEST_SUCCEEDED", component: "provider", severity: "debug", detail: `phase=${phase};attempt=${attempt + 1};elapsedMs=${Date.parse(record.endedAt) - Date.parse(record.startedAt)};withTools=${withTools}` });
        return response;
      } catch (error) {
        const cancelled = signal.aborted || (isRuntimeError(error) && error.code === "TURN_CANCELLED");
        const retryable = !cancelled && attempt < this.modelRetries && isRuntimeError(error) && error.recoverable && ["PROVIDER_TIMEOUT", "PROVIDER_NETWORK", "PROVIDER_RATE_LIMIT"].includes(error.code);
        record.status = cancelled ? "aborted" : "failed"; record.endedAt = new Date().toISOString(); if (isRuntimeError(error)) record.error = error.toRecord(); await this.persistState(false);
        this.onModelStepEvent?.({ type: "model_step_end", step, attempt: attempt + 1, result: cancelled ? "cancelled" : retryable ? "retry" : "failed" });
        this.onDiagnostic?.({ code: "MODEL_REQUEST_FAILED", component: "provider", severity: "warning", detail: `phase=${phase};attempt=${attempt + 1};elapsedMs=${Date.parse(record.endedAt) - Date.parse(record.startedAt)};code=${isRuntimeError(error) ? error.code : "UNKNOWN"};withTools=${withTools}` });
        if (cancelled) throw new RuntimeError({ code: "TURN_CANCELLED", recoverable: false, message: "当前回合已取消." });
        if (!retryable) throw error;
      }
    }
  }

  private async runTurn(input: string, signal: AbortSignal, skill?: { readonly name: string; readonly content: string }): Promise<ModelResponse> {
    this.retrievedProjectSources.clear();
    this.projectSourceReferences.clear();
    const userIndex = this.messages.length;
    this.messages.push({ role: "user", content: input });
    if (skill) this.messages.push({ role: "system", content: renderSkillContent(skill.name, skill.content), source: { kind: "skill-invocation", name: skill.name, scope: "turn", userMessageIndex: userIndex } });
    const turn: TurnRecord = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, sequence: this.journal.turns.length + 1, startedAt: new Date().toISOString(), status: "running", userMessageIndex: userIndex, attempts: [], actions: [] };
    (this.journal.turns as TurnRecord[]).push(turn);
    try { await this.persistState(); } catch (error) { this.messages.pop(); (this.journal.turns as TurnRecord[]).pop(); throw error; }
    await this.onSessionEvent?.({ type: "user", input });
    this.setTurnPhase("preflight");
    try { await this.compactIfNeeded(signal);
    const prepareRequest = async () => {
      const history = buildRequestMessageProjection(this.messages, {
        currentUserMessageIndex: userIndex,
        checkpoint: this.context?.checkpoint,
        maxTurns: this.context?.checkpoint ? this.contextRetainTurns : this.maxContextTurns,
        maxChars: this.maxContextChars,
      });
      let memoryContext: string | undefined;
      if (this.retrieveContext) {
        try {
          const retrieved = await this.retrieveContext(input, history);
          if (retrieved?.trim()) memoryContext = retrieved;
        } catch { this.onDiagnostic?.({ code: "MEMORY_RETRIEVAL_DEGRADED", component: "memory", severity: "debug" }); }
      }
      const phase = this.capabilities.length ? "agent_step" as const : "legacy" as const;
      const request = this.requestContextBuilder.build(history, phase, memoryContext, this.agentLoop ? this.task : undefined, undefined, optionsHasWorkContext(this.workMode, this.workPlan) ? { plan: this.workPlan, mode: this.workMode } : undefined);
      return { history, memoryContext, request };
    };
    let prepared = await prepareRequest();
    const requestTokenEstimate = (value: ModelRequest): number => estimateRequestTokens({ ...value, ...(this.capabilities.length && this.provider.generateWithTools ? { tools: this.selectToolDefinitions(input) } : {}) });
    if (requestTokenEstimate(prepared.request) > this.tokenBudget.maxInputTokens) {
      await this.compactIfNeeded(signal, true);
      prepared = await prepareRequest();
    }
    if (requestTokenEstimate(prepared.request) > this.tokenBudget.maxInputTokens) {
      // Tool schemas can consume a large fixed portion of the budget. If a
      // checkpoint plus schemas still cannot fit, preserve the current user
      // request and system policy but drop derived historical context.
      const minimalHistory = prepared.history.filter(message => message.role === "system");
      const currentMessage = [...this.messages].reverse().find(message => message.role === "user");
      if (currentMessage) minimalHistory.push(currentMessage);
      const phase = this.capabilities.length ? "agent_step" as const : "legacy" as const;
      const minimalWithMemory = this.requestContextBuilder.build(minimalHistory, phase, prepared.memoryContext, this.agentLoop ? this.task : undefined, undefined, optionsHasWorkContext(this.workMode, this.workPlan) ? { plan: this.workPlan, mode: this.workMode } : undefined);
      const preserveMemory = requestTokenEstimate(minimalWithMemory) <= this.tokenBudget.maxInputTokens;
      const minimalRequest = preserveMemory
        ? minimalWithMemory
        : this.requestContextBuilder.build(minimalHistory, phase, undefined, this.agentLoop ? this.task : undefined, undefined, optionsHasWorkContext(this.workMode, this.workPlan) ? { plan: this.workPlan, mode: this.workMode } : undefined);
      prepared = { history: minimalHistory, memoryContext: preserveMemory ? prepared.memoryContext : undefined, request: minimalRequest };
      this.onDiagnostic?.({ code: "CONTEXT_MINIMAL_FALLBACK", component: "context", severity: "warning", detail: `estimated=${requestTokenEstimate(minimalRequest)};budget=${this.tokenBudget.maxInputTokens}` });
    }
    const { history, memoryContext, request } = prepared;
    this.assertTokenBudget(request);
    let response: ModelResponse;
    if (this.agentLoop && this.capabilities.length && this.provider.generateWithTools) {
      response = await this.runAgentLoop(history, memoryContext, signal);
    } else if (this.capabilities.length && this.provider.generateWithTools) {
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
    response = { ...response, verificationStatus: deriveVerificationStatus(this.journal) };
    const text = response.text;
    if (!text.trim()) throw new Error("Provider returned empty text");
    const result = await this.commitResponse(response, signal);
    turn.status = response.outcome ?? "completed";
    turn.endedAt = new Date().toISOString();
    turn.assistantMessageIndex = this.messages.length - 1;
    await this.persistState(false);
    return result;
    } catch (error) {
      const failure = mapTurnFailure(error, signal.aborted);
      this.setTurnPhase(failure.status === "cancelled" ? "cancelled" : "failed", failure.record?.code ? { detail: failure.record.code } : {});
      turn.status = failure.status;
      turn.endedAt = new Date().toISOString();
      if (failure.record) turn.error = failure.record;
      await this.persistState(false);
      throw failure.errorToThrow;
    }
  }

  private async runAgentLoop(history: readonly Message[], memoryContext: string | undefined, signal: AbortSignal): Promise<ModelResponse> {
    const request = this.requestContextBuilder.build(history, "agent_step", memoryContext, this.task);
    const turn = this.journal.turns.at(-1);
    if (turn) (turn.actions as TurnActionRecord[]).push({ type: "phase", phase: "agent_step" });
    if (this.decisionPhase) {
      const decision = await runDecisionPhase(this.provider, history, { signal });
      if (decision.decision.kind === 'answer') return { text: decision.decision.text, outcome: 'completed' };
      if (decision.decision.kind === 'clarify') return { text: decision.decision.questions.join('\n'), outcome: 'needs_user' };
      this.onDiagnostic?.({ code: 'DECISION_EXECUTE', component: 'decision', severity: 'debug', detail: `repaired=${decision.repaired}` });
    }
    return this.generateWithAvailableTools(request, signal);
  }

  private assertTokenBudget(request: ModelRequest): void {
    const estimated = estimateRequestTokens(request);
    if (estimated > this.tokenBudget.maxInputTokens) {
      throw new RuntimeError({ code: 'CONTEXT_INPUT_TOO_LARGE', recoverable: false, message: `当前请求上下文过大（估算 ${estimated} tokens，预算 ${this.tokenBudget.maxInputTokens} tokens）。请压缩会话或拆分任务。` });
    }
  }

  private selectToolDefinitions(context: string): readonly ToolDefinition[] {
    const tools = this.toolRegistry.definitions().filter(tool => toolAllowedInMode(tool.name,this.workMode.mode));
    const estimated = estimateRequestTokens({ messages: [{ role: "user", content: context }], tools });
    if (estimated <= this.tokenBudget.maxInputTokens) return tools;
    const lower = context.toLowerCase();
    const browserIntent = /https?:\/\/|网页|网站|浏览器|登录|小红书|github|帖子|页面/.test(lower);
    const fileIntent = /文件|目录|读取|写入|编辑|workspace|代码/.test(lower);
    const commandIntent = /命令|测试|构建|运行|npm|shell|终端/.test(lower);
    const selected = tools.filter(tool =>
      (browserIntent && tool.name.startsWith("browser_"))
      || (fileIntent && /file|directory|project_search/i.test(tool.name))
      || (commandIntent && /command|shell|run/i.test(tool.name))
      || /ask_user|user_question|task/i.test(tool.name),
    );
    if (selected.length) {
      this.onDiagnostic?.({ code: "TOOL_SCHEMA_MINIMAL_FALLBACK", component: "context", severity: "warning", detail: `tools=${selected.length}/${tools.length}` });
      return selected;
    }
    return tools;
  }

  private async commitResponse(response: ModelResponse, signal: AbortSignal): Promise<ModelResponse> {
    if (signal.aborted) throw new RuntimeError({ code: "TURN_CANCELLED", recoverable: false, message: "当前回合已取消。" });
    await this.appendMessage({ role: "assistant", content: response.text });
      this.setTurnPhase(response.outcome === "completed" ? "settling" : response.outcome === "blocked" ? "blocked" : "settling");
      await this.onSessionEvent?.({ type: "assistant", text: response.text });
    try { await this.onTurnCommitted?.([...this.messages]); } catch { this.onDiagnostic?.({ code: "MEMORY_INDEX_FAILED", component: "memory", severity: "debug" }); }
      this.setTurnPhase(response.outcome === "completed" ? "completed" : "blocked");
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
    const state = buildSessionPersistenceState({ messages: this.messages, context: this.context, journal: this.journal, task: this.task, ...(this.taskContract ? { taskContract: this.taskContract } : {}), skillCatalog: this.skillCatalog, capabilityActivation: this.capabilityActivation, ...(this.workPlan ? { workPlan: this.workPlan } : {}), ...(this.workMode.revision > 0 ? { workMode: this.workMode } : {}) });
    if (this.onSessionStateChanged) {
      await this.onSessionStateChanged(state);
    } else if (includeMessages) {
      await this.onMessagesChanged?.(state.messages);
    }
  }

  private async compactIfNeeded(signal: AbortSignal, force = false): Promise<void> {
    if (signal.aborted) throw new RuntimeError({ code: "TURN_CANCELLED", recoverable: false, message: "当前回合已取消。" });
    if (!force && !shouldCompact(this.messages, { maxTurns: this.maxContextTurns, maxChars: this.maxContextChars })) return;
    const previousCheckpoint = this.context?.checkpoint;
    const units = selectCompactionUnits(this.messages, force ? 1 : this.contextRetainTurns, previousCheckpoint?.throughMessageIndex ?? -1);
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
      const message = prepareToolResultMessage(call.id, skipped).message;
      requestMessages?.push(message);
      await this.appendMessage(message);
    }
  }
}

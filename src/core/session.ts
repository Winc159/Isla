import type { ModelProvider, Message, ModelResponse, ToolDefinition } from "./types.js";
import { composeRequestMessages } from "../prompts/compose.js";
import { createProjectFilesCapability } from "../tools/project-files.js";
import type { ToolCapability, ToolExecutionResult } from "../tools/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { ToolRuntime } from "../tools/runtime.js";
import type { ApprovalPolicy, ApprovalService } from "../approval/types.js";
import type { PermissionPreset } from "../approval/presets.js";
import { IntentClassifier } from "./intent.js";
import { ContextResolver, type TurnSummary } from "./context.js";
import { CompletionChecker } from "./completion.js";
import { projectModelMessages, type SessionEvent } from "./events.js";
export const DEFAULT_MAX_CONTEXT_TURNS = 20;
export const DEFAULT_MAX_TOOL_ROUNDS = 8;
interface PendingExecution { readonly originalInput: string; readonly intent: import("./intent.js").IntentResult; }
export interface ChatSessionOptions {
  readonly systemPrompt?: string;
  readonly messages?: readonly Message[];
  readonly events?: readonly SessionEvent[];
  readonly maxContextTurns?: number;
  readonly onMessagesChanged?: (messages: readonly Message[]) => Promise<void>;
  readonly onSessionEvent?: (event: SessionEvent) => Promise<void>;
  readonly projectRoot?: string;
  readonly onToolsUsed?: (tools: readonly string[]) => void;
  readonly onToolStarted?: (tool: string, callId: string) => void;
  readonly onToolFinished?: (tool: string, callId: string, result: ToolExecutionResult) => void;
  readonly enableTools?: boolean;
  readonly approvalPolicy?: ApprovalPolicy;
  readonly approvalService?: ApprovalService;
  readonly permissionPreset?: PermissionPreset;
}
export class ChatSession {
  private readonly messages: Message[];
  private readonly maxContextTurns: number;
  constructor(private readonly provider: ModelProvider, options: ChatSessionOptions = {}) {
    this.messages = options.messages
      ? [...options.messages]
      : options.events
        ? projectModelMessages(options.events)
      : options.systemPrompt
        ? [{ role: "system", content: options.systemPrompt }]
        : [];
    this.maxContextTurns = options.maxContextTurns ?? DEFAULT_MAX_CONTEXT_TURNS;
    if (!Number.isInteger(this.maxContextTurns) || this.maxContextTurns <= 0)
      throw new Error("maxContextTurns must be a positive integer");
    this.onMessagesChanged = options.onMessagesChanged;
    this.onSessionEvent = options.onSessionEvent;
    this.projectRoot = options.projectRoot;
    this.onToolsUsed = options.onToolsUsed;
    this.onToolStarted = options.onToolStarted;
    this.onToolFinished = options.onToolFinished;
    this.enableTools = options.enableTools ?? false;
    this.capabilities = this.enableTools && this.provider.generateWithTools
      ? [createProjectFilesCapability(this.projectRoot ?? process.cwd())]
      : [];
    this.toolRegistry = new ToolRegistry();
    for (const capability of this.capabilities) this.toolRegistry.registerCapability(capability);
    this.intentClassifier = this.capabilities.length ? new IntentClassifier(this.provider) : undefined;
    this.toolRuntime = new ToolRuntime(this.toolRegistry, {
      approvalPolicy: options.approvalPolicy,
      approvalService: options.approvalService,
      permissionPreset: options.permissionPreset,
    });
  }
  private readonly onMessagesChanged: ((messages: readonly Message[]) => Promise<void>) | undefined;
  private readonly onSessionEvent: ((event: SessionEvent) => Promise<void>) | undefined;
  private readonly projectRoot: string | undefined;
  private readonly onToolsUsed: ((tools: readonly string[]) => void) | undefined;
  private readonly onToolStarted: ((tool: string, callId: string) => void) | undefined;
  private readonly onToolFinished: ((tool: string, callId: string, result: ToolExecutionResult) => void) | undefined;
  private readonly enableTools: boolean;
  private readonly capabilities: readonly ToolCapability[];
  private readonly toolRegistry: ToolRegistry;
  private readonly toolRuntime: ToolRuntime;
  private readonly intentClassifier: IntentClassifier | undefined;
  private readonly summaries: TurnSummary[] = [];
  private readonly contextResolver = new ContextResolver();
  private readonly completionChecker = new CompletionChecker();
  private pendingConfirmation: PendingExecution | undefined;
  async send(input: string): Promise<ModelResponse> {
    return this.runTurn(input, undefined);
  }

  private async generateWithAvailableTools(request: { messages: Message[] }, requireWriteTool = false, requireReadTool = false, requiredEvidence: readonly string[] = [], readOnly = false): Promise<ModelResponse> {
    const provider = this.provider;
    if (!this.enableTools || !provider.generateWithTools) return provider.generate(request);
    let current = request.messages;
    let readSucceeded = false;
    let writeSucceeded = false;
    const evidence: string[] = [];
    const failures = new Map<string, number>();
    const successfulWrites = new Set<string>();
    let missingWriteToolRetries = 0;
    const tools: readonly ToolDefinition[] = readOnly
      ? this.toolRegistry.definitions().filter(tool => tool.name === "list_directory" || tool.name === "read_text_file")
      : this.toolRegistry.definitions();
    for (let round = 0; round < DEFAULT_MAX_TOOL_ROUNDS; round += 1) {
      const response = await provider.generateWithTools({ messages: current, tools, ...(requireWriteTool && !writeSucceeded ? { toolChoice: { name: "write_text_file" } } : {}) });
      if (!response.toolCalls?.length) {
        if (requireWriteTool && !writeSucceeded) {
          if (missingWriteToolRetries < 1) {
            missingWriteToolRetries += 1;
            current = [
              ...current,
              ...(response.text.trim() ? [{ role: "assistant" as const, content: response.text }] : []),
              { role: "system", content: "上一步没有产生必需的 write_text_file Tool Call。当前任务已经确认执行；只返回 write_text_file Tool Call，不要返回说明文字。" },
            ];
            continue;
          }
          return { text: "未执行写入：模型在一次纠偏后仍未调用 write_text_file，因此没有创建或修改文件。", outcome: "blocked", ...(response.model ? { model: response.model } : {}) };
        }
        if (requireReadTool && !this.completionChecker.check({ kind: "inspect", requiredEvidence }, evidence).complete) return { text: "未完成检查：尚未获得相关文件或目录的成功读取结果。", outcome: "blocked", evidence, ...(response.model ? { model: response.model } : {}) };
        return { ...response, ...(evidence.length ? { evidence } : {}) };
      }
      const next = [...current, { role: "assistant" as const, content: "", toolCalls: response.toolCalls }];
      for (const call of response.toolCalls) {
        const writeKey = `${call.name}:${call.arguments}`;
        if (call.name === "write_text_file" && successfulWrites.has(writeKey)) {
          return { text: "写入已完成，已停止重复写入。", outcome: "completed", evidence, model: response.model ?? provider.model };
        }
        await this.onSessionEvent?.({ type: "tool_call", callId: call.id, tool: call.name, arguments: call.arguments });
        this.onToolStarted?.(call.name, call.id);
        let result: string;
        let execution: ToolExecutionResult = { ok: false, code: "EXECUTION_FAILED", message: "Tool execution interrupted" };
        try {
          execution = await this.toolRuntime.execute(call);
          if (execution.ok && (call.name === "list_directory" || call.name === "read_text_file")) { readSucceeded = true; evidence.push(call.name); }
          if (execution.ok && call.name === "write_text_file") { writeSucceeded = true; successfulWrites.add(writeKey); }
          result = execution.ok ? execution.content : `[${execution.code}] ${execution.message}`;
          if (!execution.ok) {
            if (execution.code === "USER_REJECTED") {
              return { text: "用户拒绝了工具调用，已停止本轮执行。", outcome: "blocked", evidence, ...(response.model ? { model: response.model } : {}) };
            }
            const key = `${call.name}:${call.arguments}:${execution.code}`;
            const count = (failures.get(key) ?? 0) + 1;
            failures.set(key, count);
            if (count >= 2) return { text: "工具调用连续失败，已停止自动重试。", outcome: "blocked", evidence, ...(response.model ? { model: response.model } : {}) };
          }
        } finally {
          this.onToolFinished?.(call.name, call.id, execution);
          await this.onSessionEvent?.({ type: "tool_result", callId: call.id, tool: call.name, result: execution });
        }
        this.onToolsUsed?.([call.name]);
        next.push({ role: "tool", toolCallId: call.id, content: result });
      }
      current = next;
    }
    return { text: "工具调用达到本轮上限，已停止继续执行。", outcome: "blocked", model: provider.model };
  }
  async sendStream(input: string, onChunk: (text: string) => void): Promise<ModelResponse> {
    return this.runTurn(input, onChunk);
  }

  private async runTurn(input: string, onChunk?: (text: string) => void): Promise<ModelResponse> {
    this.messages.push({ role: "user", content: input });
    await this.onSessionEvent?.({ type: "user", input });
    await this.onMessagesChanged?.([...this.messages]);
    let intent = this.intentClassifier ? await this.intentClassifier.classify(input) : undefined;
    if (intent) await this.onSessionEvent?.({ type: "intent", intent });
    if (this.pendingConfirmation && isConfirmation(input)) {
      intent = { ...this.pendingConfirmation.intent, requiresUserConfirmation: false };
      input = this.pendingConfirmation.originalInput;
      this.pendingConfirmation = undefined;
    }
    if (intent?.kind === "unknown") {
      return this.commitAndEmit("我还不能安全判断你的目标。请说明是要查看、讨论，还是执行具体修改。", "needs_user", onChunk);
    }
    if (intent?.kind === "execute" && intent.requiresUserConfirmation) {
      this.pendingConfirmation = { originalInput: input, intent };
      return this.commitAndEmit("执行前需要你的确认：" + intent.goal, "completed", onChunk);
    }
    if (this.pendingConfirmation && isConfirmation(input)) this.pendingConfirmation = undefined;
    const contextSelection: { readonly recentTurns: number; readonly summaryTurns: readonly number[] } = intent ? this.contextResolver.select(intent, this.summaries) : { recentTurns: this.maxContextTurns, summaryTurns: [] };
    const history = selectRecentTurns(this.messages, Math.min(this.maxContextTurns, contextSelection.recentTurns));
    const selectedSummaries = contextSelection.summaryTurns;
    const summaryMessages = this.summaries.filter(summary => selectedSummaries.includes(summary.turn)).map(summary => ({ role: "system" as const, content: `历史摘要（第 ${summary.turn} 轮，${summary.category}）：${summary.summary}` }));
    const needsReadEvidence = intent?.kind === "discuss" && /(?:当前|项目|源码|代码|文件|读取|查看|基于|read|inspect|source|code|project)/iu.test(input);
    const phase = intent?.kind === "discuss" ? "discussion" as const : intent?.kind === "execute" ? "execution" as const : this.capabilities.length ? "tool-loop" as const : "legacy" as const;
    const request = { messages: composeRequestMessages([...summaryMessages, ...history], intent?.kind === "discuss" && !needsReadEvidence ? [] : this.capabilities, phase) };
    let response: ModelResponse;
    if (needsReadEvidence && this.capabilities.length && this.provider.generateWithTools) {
      response = await this.generateWithAvailableTools(request, false, true, intent?.requiredEvidence, true);
      onChunk?.(response.text);
    } else if (intent?.kind === "discuss" || intent?.kind === "answer") {
      let streamedText = "";
      if (onChunk) {
        for await (const chunk of this.provider.generateStream(request)) { if (chunk.text) { streamedText += chunk.text; onChunk(chunk.text); } }
      } else {
        const generated = await this.provider.generate(request);
        streamedText = generated.text;
      }
      response = { text: streamedText, model: this.provider.model };
    } else if (this.capabilities.length && this.provider.generateWithTools) {
      response = await this.generateWithAvailableTools(request, intent?.kind === "execute", intent?.kind === "inspect", intent?.requiredEvidence);
      onChunk?.(response.text);
    } else {
      let streamedText = "";
      if (onChunk) {
        for await (const chunk of this.provider.generateStream(request)) {
          if (chunk.text) { streamedText += chunk.text; onChunk(chunk.text); }
        }
      } else {
        const generated = await this.provider.generate(request);
        streamedText = generated.text;
      }
      response = { text: streamedText, model: this.provider.model };
    }
    const text = response.text;
    if (!text.trim()) throw new Error("Provider returned empty text");
    return this.commitResponse(response, intent?.kind ?? "answer");
  }

  private async commitAndEmit(text: string, outcome: "completed" | "needs_user" | "blocked", onChunk?: (text: string) => void): Promise<ModelResponse> {
    const response = await this.commitAssistant(text, outcome);
    onChunk?.(response.text);
    return response;
  }

  private async commitAssistant(text: string, outcome: "completed" | "needs_user" | "blocked" = "completed"): Promise<ModelResponse> {
    return this.commitResponse({ text, model: this.provider.model, outcome }, "answer");
  }

  private async commitResponse(response: ModelResponse, category: string): Promise<ModelResponse> {
    this.messages.push({ role: "assistant", content: response.text });
    try { await this.onMessagesChanged?.([...this.messages]); }
    catch (error) { this.messages.pop(); throw error; }
    await this.onSessionEvent?.({ type: "assistant", text: response.text, ...(response.outcome ? { outcome: response.outcome } : {}) });
    this.summaries.push({
      turn: this.summaries.length + 1,
      category,
      summary: response.text.slice(0, 500),
      decisions: [],
      pending: [],
      evidence: response.evidence ?? [],
      outcome: response.outcome ?? (category === "unknown" ? "needs_user" : "completed"),
    });
    await this.onSessionEvent?.({ type: "turn_summary", turn: this.summaries.length, category, evidence: response.evidence ?? [], outcome: response.outcome ?? (category === "unknown" ? "needs_user" : "completed") });
    return response;
  }
}

function isConfirmation(input: string): boolean { return /^(?:确认|确认执行|是|好的|可以|开始|yes|y|ok|okay|proceed)$/i.test(input.trim()); }

function selectRecentTurns(messages: readonly Message[], maxTurns: number): Message[] {
  const systemMessages = messages.filter(message => message.role === "system");
  const conversation = messages.filter(message => message.role !== "system");
  let start = conversation.length;
  let turns = 0;
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    if (conversation[index]?.role !== "user") continue;
    turns += 1;
    if (turns > maxTurns) break;
    start = index;
  }
  return [...systemMessages, ...conversation.slice(start)];
}

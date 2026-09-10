import type { ModelProvider, Message, ModelResponse, ToolDefinition } from "./types.js";
import { composeRequestMessages } from "../prompts/compose.js";
import { createProjectFilesCapability } from "../tools/project-files.js";
import type { ToolCapability } from "../tools/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { ToolRuntime } from "../tools/runtime.js";
import type { ApprovalPolicy, ApprovalService } from "../approval/types.js";
import type { PermissionPreset } from "../approval/presets.js";
import { IntentClassifier } from "./intent.js";
import { ContextResolver, type TurnSummary } from "./context.js";
export const DEFAULT_MAX_CONTEXT_TURNS = 20;
export const DEFAULT_MAX_TOOL_ROUNDS = 8;
interface PendingExecution { readonly originalInput: string; readonly intent: import("./intent.js").IntentResult; }
export interface ChatSessionOptions {
  readonly systemPrompt?: string;
  readonly messages?: readonly Message[];
  readonly maxContextTurns?: number;
  readonly onMessagesChanged?: (messages: readonly Message[]) => Promise<void>;
  readonly projectRoot?: string;
  readonly onToolsUsed?: (tools: readonly string[]) => void;
  readonly onToolStarted?: (tool: string) => void;
  readonly onToolFinished?: (tool: string) => void;
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
      : options.systemPrompt
        ? [{ role: "system", content: options.systemPrompt }]
        : [];
    this.maxContextTurns = options.maxContextTurns ?? DEFAULT_MAX_CONTEXT_TURNS;
    if (!Number.isInteger(this.maxContextTurns) || this.maxContextTurns <= 0)
      throw new Error("maxContextTurns must be a positive integer");
    this.onMessagesChanged = options.onMessagesChanged;
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
      onApproved: tool => this.onToolStarted?.(tool),
    });
  }
  private readonly onMessagesChanged: ((messages: readonly Message[]) => Promise<void>) | undefined;
  private readonly projectRoot: string | undefined;
  private readonly onToolsUsed: ((tools: readonly string[]) => void) | undefined;
  private readonly onToolStarted: ((tool: string) => void) | undefined;
  private readonly onToolFinished: ((tool: string) => void) | undefined;
  private readonly enableTools: boolean;
  private readonly capabilities: readonly ToolCapability[];
  private readonly toolRegistry: ToolRegistry;
  private readonly toolRuntime: ToolRuntime;
  private readonly intentClassifier: IntentClassifier | undefined;
  private readonly summaries: TurnSummary[] = [];
  private readonly contextResolver = new ContextResolver();
  private pendingConfirmation: PendingExecution | undefined;
  async send(input: string): Promise<ModelResponse> {
    this.messages.push({ role: "user", content: input });
    await this.onMessagesChanged?.([...this.messages]);
    const history = selectRecentTurns(this.messages, this.maxContextTurns);
    let intent = this.intentClassifier ? await this.intentClassifier.classify(input) : undefined;
    if (this.pendingConfirmation && isConfirmation(input)) {
      intent = this.pendingConfirmation.intent;
      input = this.pendingConfirmation.originalInput;
      this.pendingConfirmation = undefined;
    }
    if (intent?.kind === "unknown") return await this.commitAssistant("我还不能安全判断你的目标。请说明是要查看、讨论，还是执行具体修改。");
    if (intent?.kind === "execute" && intent.requiresUserConfirmation) {
      this.pendingConfirmation = { originalInput: input, intent };
      return await this.commitAssistant("执行前需要你的确认：" + intent.goal);
    }
    const selectedSummaries = intent ? this.contextResolver.select(intent, this.summaries).summaryTurns : [];
    const summaryMessages = this.summaries.filter(summary => selectedSummaries.includes(summary.turn)).map(summary => ({ role: "system" as const, content: `历史摘要（第 ${summary.turn} 轮，${summary.category}）：${summary.summary}` }));
    const phase = intent?.kind === "discuss" ? "discussion" as const : this.capabilities.length ? "tool-loop" as const : "legacy" as const;
    const request = { messages: composeRequestMessages([...summaryMessages, ...history], intent?.kind === "discuss" ? [] : this.capabilities, phase) };
    const response = intent?.kind === "discuss" || intent?.kind === "answer"
      ? await this.provider.generate(request)
      : this.capabilities.length
        ? await this.generateWithAvailableTools(request, intent?.kind === "execute", intent?.kind === "inspect")
        : await this.provider.generate(request);
    if (!response.text.trim()) throw new Error("Provider returned empty text");
    return this.commitResponse(response, intent?.kind ?? "answer");
  }

  private async generateWithAvailableTools(request: { messages: Message[] }, requireWriteTool = false, requireReadTool = false): Promise<ModelResponse> {
    const provider = this.provider;
    if (!this.enableTools || !provider.generateWithTools) return provider.generate(request);
    let current = request.messages;
    let readSucceeded = false;
    const failures = new Map<string, number>();
    const tools: readonly ToolDefinition[] = this.toolRegistry.definitions();
    for (let round = 0; round < DEFAULT_MAX_TOOL_ROUNDS; round += 1) {
      const response = await provider.generateWithTools({ messages: current, tools, ...(requireWriteTool ? { toolChoice: { name: "write_text_file" } } : {}) });
      if (!response.toolCalls?.length) {
        if (requireWriteTool) return { text: "未执行写入：模型没有调用 write_text_file，因此没有创建或修改文件。", ...(response.model ? { model: response.model } : {}) };
        if (requireReadTool && !readSucceeded) return { text: "未完成检查：尚未获得相关文件或目录的成功读取结果。", ...(response.model ? { model: response.model } : {}) };
        return response;
      }
      const next = [...current, { role: "assistant" as const, content: "", toolCalls: response.toolCalls }];
      for (const call of response.toolCalls) {
        let result: string;
        try {
          const execution = await this.toolRuntime.execute(call);
          if (execution.ok && (call.name === "list_directory" || call.name === "read_text_file")) readSucceeded = true;
          result = execution.ok ? execution.content : `[${execution.code}] ${execution.message}`;
          if (!execution.ok) {
            const key = `${call.name}:${call.arguments}:${execution.code}`;
            const count = (failures.get(key) ?? 0) + 1;
            failures.set(key, count);
            if (count >= 2) return { text: "工具调用连续失败，已停止自动重试。", ...(response.model ? { model: response.model } : {}) };
          }
        } finally {
          this.onToolFinished?.(call.name);
        }
        this.onToolsUsed?.([call.name]);
        next.push({ role: "tool", toolCallId: call.id, content: result });
      }
      current = next;
    }
    throw new Error("Tool call limit exceeded");
  }
  async sendStream(input: string, onChunk: (text: string) => void): Promise<ModelResponse> {
    this.messages.push({ role: "user", content: input });
    await this.onMessagesChanged?.([...this.messages]);
    const history = selectRecentTurns(this.messages, this.maxContextTurns);
    let intent = this.intentClassifier ? await this.intentClassifier.classify(input) : undefined;
    if (this.pendingConfirmation && isConfirmation(input)) {
      intent = this.pendingConfirmation.intent;
      input = this.pendingConfirmation.originalInput;
      this.pendingConfirmation = undefined;
    }
    if (intent?.kind === "unknown") {
      const response = await this.commitAssistant("我还不能安全判断你的目标。请说明是要查看、讨论，还是执行具体修改。");
      onChunk(response.text);
      return response;
    }
    if (intent?.kind === "execute" && intent.requiresUserConfirmation) {
      this.pendingConfirmation = { originalInput: input, intent };
      const response = await this.commitAssistant("执行前需要你的确认：" + intent.goal);
      onChunk(response.text);
      return response;
    }
    if (this.pendingConfirmation && isConfirmation(input)) this.pendingConfirmation = undefined;
    const selectedSummaries = intent ? this.contextResolver.select(intent, this.summaries).summaryTurns : [];
    const summaryMessages = this.summaries.filter(summary => selectedSummaries.includes(summary.turn)).map(summary => ({ role: "system" as const, content: `历史摘要（第 ${summary.turn} 轮，${summary.category}）：${summary.summary}` }));
    const phase = intent?.kind === "discuss" ? "discussion" as const : this.capabilities.length ? "tool-loop" as const : "legacy" as const;
    const request = { messages: composeRequestMessages([...summaryMessages, ...history], intent?.kind === "discuss" ? [] : this.capabilities, phase) };
    let response: ModelResponse;
    if (intent?.kind === "discuss" || intent?.kind === "answer") {
      let streamedText = "";
      for await (const chunk of this.provider.generateStream(request)) { if (chunk.text) { streamedText += chunk.text; onChunk(chunk.text); } }
      response = { text: streamedText, model: this.provider.model };
    } else if (this.capabilities.length && this.provider.generateWithTools) {
      response = await this.generateWithAvailableTools(request, intent?.kind === "execute", intent?.kind === "inspect");
      onChunk(response.text);
    } else {
      let streamedText = "";
      for await (const chunk of this.provider.generateStream(request)) {
        if (chunk.text) { streamedText += chunk.text; onChunk(chunk.text); }
      }
      response = { text: streamedText, model: this.provider.model };
    }
    const text = response.text;
    if (!text.trim()) throw new Error("Provider returned empty text");
    return this.commitResponse(response, intent?.kind ?? "answer");
  }

  private async commitAssistant(text: string): Promise<ModelResponse> {
    return this.commitResponse({ text, model: this.provider.model }, "answer");
  }

  private async commitResponse(response: ModelResponse, category: string): Promise<ModelResponse> {
    this.messages.push({ role: "assistant", content: response.text });
    try { await this.onMessagesChanged?.([...this.messages]); }
    catch (error) { this.messages.pop(); throw error; }
    this.summaries.push({ turn: this.summaries.length + 1, category, summary: response.text.slice(0, 500), decisions: [], pending: [] });
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

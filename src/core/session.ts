import type { ModelProvider, Message, ModelResponse, ToolDefinition } from "./types.js";
import { composeRequestMessages } from "../prompts/compose.js";
import { createProjectFilesCapability } from "../tools/project-files.js";
import type { ToolCapability, ToolExecutionResult } from "../tools/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { ToolRuntime } from "../tools/runtime.js";
import type { ApprovalPolicy, ApprovalService } from "../approval/types.js";
import type { PermissionPreset } from "../approval/presets.js";
import type { SessionEvent } from "./events.js";
export const DEFAULT_MAX_CONTEXT_TURNS = 20;
export const DEFAULT_MAX_TOOL_ROUNDS = 8;
export interface ChatSessionOptions {
  readonly systemPrompt?: string;
  readonly messages?: readonly Message[];
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
  async send(input: string): Promise<ModelResponse> {
    return this.runTurn(input);
  }

  private async generateWithAvailableTools(request: { messages: Message[] }): Promise<ModelResponse> {
    const provider = this.provider;
    if (!this.enableTools || !provider.generateWithTools) return provider.generate(request);
    let current = request.messages;
    const evidence: string[] = [];
    const failures = new Map<string, number>();
    const successfulWrites = new Set<string>();
    const tools: readonly ToolDefinition[] = this.toolRegistry.definitions();
    for (let round = 0; round < DEFAULT_MAX_TOOL_ROUNDS; round += 1) {
      const response = await provider.generateWithTools({ messages: current, tools });
      if (!response.toolCalls?.length) {
        return { ...response, ...(evidence.length ? { evidence } : {}) };
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
          execution = await this.toolRuntime.execute(call);
          if (execution.ok && (call.name === "list_directory" || call.name === "read_text_file")) evidence.push(call.name);
          if (execution.ok && call.name === "write_text_file") successfulWrites.add(writeKey);
          result = execution.ok ? execution.content : `[${execution.code}] ${execution.message}`;
          if (!execution.ok) {
            if (execution.code === "USER_REJECTED") {
              terminalResponse = { text: "用户拒绝了工具调用，已停止本轮执行。", outcome: "blocked", evidence, ...(response.model ? { model: response.model } : {}) };
            }
            const key = `${call.name}:${call.arguments}:${execution.code}`;
            const count = (failures.get(key) ?? 0) + 1;
            failures.set(key, count);
            if (count >= 2) terminalResponse = { text: "工具调用连续失败，已停止自动重试。", outcome: "blocked", evidence, ...(response.model ? { model: response.model } : {}) };
          }
        } finally {
          this.onToolFinished?.(call.name, call.id, execution);
          await this.onSessionEvent?.({ type: "tool_result", callId: call.id, tool: call.name, result: execution });
        }
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
  private async runTurn(input: string): Promise<ModelResponse> {
    await this.appendMessage({ role: "user", content: input });
    await this.onSessionEvent?.({ type: "user", input });
    const history = selectRecentTurns(this.messages, this.maxContextTurns);
    const phase = this.capabilities.length ? "tool-loop" as const : "legacy" as const;
    const request = { messages: composeRequestMessages(history, this.capabilities, phase) };
    let response: ModelResponse;
    if (this.capabilities.length && this.provider.generateWithTools) {
      response = await this.generateWithAvailableTools(request);
    } else {
      response = await this.provider.generate(request);
    }
    const text = response.text;
    if (!text.trim()) throw new Error("Provider returned empty text");
    return this.commitResponse(response);
  }

  private async commitResponse(response: ModelResponse): Promise<ModelResponse> {
    await this.appendMessage({ role: "assistant", content: response.text });
    await this.onSessionEvent?.({ type: "assistant", text: response.text });
    return response;
  }

  private async appendMessage(message: Message): Promise<void> {
    this.messages.push(message);
    try { await this.onMessagesChanged?.([...this.messages]); }
    catch (error) { this.messages.pop(); throw error; }
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

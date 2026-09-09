import type { ModelProvider, Message, ModelResponse, ToolDefinition } from "./types.js";
import { composeRequestMessages } from "../prompts/compose.js";
import { createProjectFilesCapability } from "../tools/project-files.js";
import type { ToolCapability } from "../tools/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { ToolRuntime } from "../tools/runtime.js";
import type { ApprovalPolicy, ApprovalService } from "../approval/types.js";
import type { PermissionPreset } from "../approval/presets.js";
export const DEFAULT_MAX_CONTEXT_TURNS = 20;
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
    this.toolRuntime = new ToolRuntime(this.toolRegistry, {
      approvalPolicy: options.approvalPolicy,
      approvalService: options.approvalService,
      permissionPreset: options.permissionPreset,
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
  async send(input: string): Promise<ModelResponse> {
    this.messages.push({ role: "user", content: input });
    await this.onMessagesChanged?.([...this.messages]);
    const history = selectRecentTurns(this.messages, this.maxContextTurns);
    const request = { messages: composeRequestMessages(history, this.capabilities) };
    const response = this.capabilities.length
      ? await this.generateWithAvailableTools(request)
      : await this.provider.generate(request);
    if (!response.text.trim()) throw new Error("Provider returned empty text");
    this.messages.push({ role: "assistant", content: response.text });
    try {
      await this.onMessagesChanged?.([...this.messages]);
    } catch (error) {
      this.messages.pop();
      throw error;
    }
    return response;
  }

  private async generateWithAvailableTools(request: { messages: Message[] }): Promise<ModelResponse> {
    const provider = this.provider;
    if (!this.enableTools || !provider.generateWithTools) return provider.generate(request);
    let current = request.messages;
    const tools: readonly ToolDefinition[] = this.toolRegistry.definitions();
    for (let round = 0; round < 3; round += 1) {
      const response = await provider.generateWithTools({ messages: current, tools });
      if (!response.toolCalls?.length) return response;
      const next = [...current, { role: "assistant" as const, content: "", toolCalls: response.toolCalls }];
      for (const call of response.toolCalls) {
        this.onToolStarted?.(call.name);
        let result: string;
        try {
          const execution = await this.toolRuntime.execute(call);
          result = execution.ok ? execution.content : `[${execution.code}] ${execution.message}`;
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
    const request = { messages: composeRequestMessages(history, this.capabilities) };
    let response: ModelResponse;
    if (this.capabilities.length && this.provider.generateWithTools) {
      response = await this.generateWithAvailableTools(request);
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
    this.messages.push({ role: "assistant", content: text });
    try { await this.onMessagesChanged?.([...this.messages]); }
    catch (error) { this.messages.pop(); throw error; }
    return response;
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

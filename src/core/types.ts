import type { ModelStreamEvent } from "./model-stream.js";
import type { VerificationStatus } from "./verification.js";
export type MessageRole = "system" | "user" | "assistant" | "tool";
export interface MessageSource { readonly kind: "skill-invocation"; readonly name: string; readonly scope: "turn"; readonly userMessageIndex: number; }
export interface Message { readonly role: MessageRole; readonly content: string; readonly toolCalls?: readonly ToolCall[]; readonly toolCallId?: string; readonly source?: MessageSource; }
export interface ToolDefinition { readonly name: string; readonly description: string; readonly parameters: Record<string, unknown>; }
export interface ToolCall { readonly id: string; readonly name: string; readonly arguments: string; }
export interface ModelRequest { readonly messages: readonly Message[]; readonly tools?: readonly ToolDefinition[]; readonly toolChoice?: "auto" | "required" | { readonly name: string }; readonly responseFormat?: { readonly type: "json_object" }; }
export interface ModelCallOptions { readonly signal?: AbortSignal; }
export interface TokenUsage { readonly input?: number; readonly output?: number; readonly total?: number; }
export interface ProviderCapabilities {
  readonly toolCalling: boolean;
  readonly nativeStreaming: boolean;
  readonly streamingToolCalls: boolean;
}
export type TurnOutcome = "completed" | "needs_user" | "blocked";
export interface ProjectSourceReference { readonly path: string; readonly startLine: number; }
export interface ModelResponse { readonly text: string; readonly model?: string; readonly usage?: TokenUsage; readonly outcome?: TurnOutcome; readonly evidence?: readonly string[]; readonly projectSources?: readonly ProjectSourceReference[]; readonly verificationStatus?: VerificationStatus; }
export interface ToolResponse extends ModelResponse { readonly toolCalls?: readonly ToolCall[]; readonly assistantContent?: string | null; }
export interface ModelProvider {
  readonly id: string;
  readonly model: string;
  readonly capabilities?: ProviderCapabilities;
  readonly streamingEnabled?: boolean;
  generate(request: ModelRequest, options?: ModelCallOptions): Promise<ModelResponse>;
  generateWithTools?(request: ModelRequest, options?: ModelCallOptions): Promise<ToolResponse>;
  generateStream?(request: ModelRequest, options?: ModelCallOptions): AsyncIterable<ModelStreamEvent>;
}

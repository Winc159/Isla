export type MessageRole = "system" | "user" | "assistant" | "tool";
export interface Message { readonly role: MessageRole; readonly content: string; readonly toolCalls?: readonly ToolCall[]; readonly toolCallId?: string; }
export interface ToolDefinition { readonly name: string; readonly description: string; readonly parameters: Record<string, unknown>; }
export interface ToolCall { readonly id: string; readonly name: string; readonly arguments: string; }
export interface ModelRequest { readonly messages: readonly Message[]; readonly tools?: readonly ToolDefinition[]; readonly toolChoice?: "auto" | "required" | { readonly name: string }; }
export interface TokenUsage { readonly input?: number; readonly output?: number; readonly total?: number; }
export interface ModelResponse { readonly text: string; readonly model?: string; readonly usage?: TokenUsage; }
export interface ToolResponse extends ModelResponse { readonly toolCalls?: readonly ToolCall[]; }
export interface ModelChunk { readonly text: string; }
export interface ModelProvider {
  readonly id: string;
  readonly model: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
  generateWithTools?(request: ModelRequest): Promise<ToolResponse>;
  generateStream(request: ModelRequest): AsyncIterable<ModelChunk>;
}

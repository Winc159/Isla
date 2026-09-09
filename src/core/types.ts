export type MessageRole = "system" | "user" | "assistant";
export interface Message { readonly role: MessageRole; readonly content: string; }
export interface ModelRequest { readonly messages: readonly Message[]; }
export interface TokenUsage { readonly input?: number; readonly output?: number; readonly total?: number; }
export interface ModelResponse { readonly text: string; readonly model?: string; readonly usage?: TokenUsage; }
export interface ModelChunk { readonly text: string; }
export interface ModelProvider {
  readonly id: string;
  readonly model: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
  generateStream(request: ModelRequest): AsyncIterable<ModelChunk>;
}

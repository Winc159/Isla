import type { ModelProvider, Message, ModelResponse } from "./types.js";
export const DEFAULT_MAX_CONTEXT_TURNS = 20;
export interface ChatSessionOptions {
  readonly systemPrompt?: string;
  readonly messages?: readonly Message[];
  readonly maxContextTurns?: number;
  readonly onMessagesChanged?: (messages: readonly Message[]) => Promise<void>;
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
  }
  private readonly onMessagesChanged: ((messages: readonly Message[]) => Promise<void>) | undefined;
  async send(input: string): Promise<ModelResponse> {
    this.messages.push({ role: "user", content: input });
    await this.onMessagesChanged?.([...this.messages]);
    const response = await this.provider.generate({
      messages: selectRecentTurns(this.messages, this.maxContextTurns),
    });
    if (!response.text.trim()) throw new Error("Provider returned empty text");
    this.messages.push({ role: "assistant", content: response.text });
    await this.onMessagesChanged?.([...this.messages]);
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

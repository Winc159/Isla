import type { ModelProvider, Message, ModelResponse } from "./types.js";
export class ChatSession {
  private readonly messages: Message[];
  constructor(private readonly provider: ModelProvider, systemPrompt?: string) {
    this.messages = systemPrompt ? [{ role: "system", content: systemPrompt }] : [];
  }
  async send(input: string): Promise<ModelResponse> {
    this.messages.push({ role: "user", content: input });
    const response = await this.provider.generate({ messages: [...this.messages] });
    if (!response.text.trim()) throw new Error("Provider returned empty text");
    this.messages.push({ role: "assistant", content: response.text });
    return response;
  }
}

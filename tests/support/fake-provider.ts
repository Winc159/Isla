import type { ModelProvider, ModelRequest, ModelResponse } from "../../src/core/types.js";
export class FakeProvider implements ModelProvider {
  readonly id = "fake"; readonly model = "fake-model"; readonly requests: ModelRequest[] = [];
  private index = 0;
  constructor(private readonly responses: Array<ModelResponse | Error>) {}
  async generate(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request); const result = this.responses[this.index++];
    if (!result) throw new Error("No fake response configured");
    if (result instanceof Error) throw result; return result;
  }
  async *generateStream(request: ModelRequest): AsyncIterable<{ text: string }> {
    this.requests.push(request); const result = this.responses[this.index++];
    if (!result) throw new Error("No fake response configured");
    if (result instanceof Error) throw result;
    for (const text of result.text.match(/.{1,2}/gs) ?? []) yield { text };
  }
}

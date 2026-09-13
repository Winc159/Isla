import type { ModelCallOptions, ModelProvider, ModelRequest, ModelResponse } from "../../src/core/types.js";
export class FakeProvider implements ModelProvider {
  readonly id = "fake"; readonly model = "fake-model"; readonly requests: ModelRequest[] = []; readonly signals: (AbortSignal | undefined)[] = [];
  private index = 0;
  constructor(private readonly responses: Array<ModelResponse | Error>) {}
  async generate(request: ModelRequest, options?: ModelCallOptions): Promise<ModelResponse> {
    this.requests.push(request); this.signals.push(options?.signal); const result = this.responses[this.index++];
    if (!result) throw new Error("No fake response configured");
    if (result instanceof Error) throw result; return result;
  }
}

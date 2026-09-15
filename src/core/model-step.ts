import { ModelStreamAssembler } from "./model-stream.js";
import type { ModelStepEvent } from "./events.js";
import type { ModelProvider, ModelRequest, ModelResponse, ToolResponse } from "./types.js";

export interface ModelStepRunnerOptions {
  readonly provider: ModelProvider;
  readonly step: number;
  readonly attempt: number;
  readonly withTools: boolean;
  readonly signal: AbortSignal;
  readonly onEvent?: (event: ModelStepEvent) => void;
}

/** 只负责执行一个模型 Step；Journal、重试和最终提交仍由 ChatSession 所有。 */
export class ModelStepRunner {
  async run(request: ModelRequest, options: ModelStepRunnerOptions): Promise<ModelResponse | ToolResponse> {
    const { provider, step, attempt, withTools, signal, onEvent } = options;
    onEvent?.({ type: "model_step_start", step, attempt });
    try {
      if (signal.aborted) throw new Error("aborted");
      let response: ModelResponse | ToolResponse;
      // Providers may expose text streaming while still requiring the stable
      // one-shot tool-call protocol. Keep tool turns on that protocol unless
      // streaming tool calls are explicitly supported.
      if (provider.streamingEnabled && provider.generateStream && (!withTools || provider.capabilities?.streamingToolCalls)) {
        const assembler = new ModelStreamAssembler();
        for await (const event of provider.generateStream(request, { signal })) {
          if (event.type === "text_delta" && event.delta) onEvent?.({ type: "model_delta", step, attempt, text: event.delta, provisional: true });
          assembler.add(event);
        }
        response = assembler.finish().response;
      } else {
        response = withTools && provider.generateWithTools
          ? await provider.generateWithTools(request, { signal })
          : await provider.generate(request, { signal });
      }
      const hasToolCalls = "toolCalls" in response && Boolean(response.toolCalls?.length);
      onEvent?.({ type: "model_step_end", step, attempt, result: hasToolCalls ? "capability_calls" : "candidate_yield" });
      return response;
    } catch (error) {
      throw error;
    }
  }
}

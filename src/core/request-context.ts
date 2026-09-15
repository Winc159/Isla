import type { TaskBrief } from "./agent-loop.js";
import type { Message, ModelRequest } from "./types.js";
import type { ToolCapability } from "../tools/types.js";
import { composeRequestMessages } from "../prompts/compose.js";

export interface RequestContextBuilderOptions {
  readonly capabilities: readonly ToolCapability[];
}

/** 集中构造模型可见请求；不调用 Provider，也不修改 Session。 */
export class RequestContextBuilder {
  constructor(private readonly options: RequestContextBuilderOptions) {}

  build(history: readonly Message[], phase: "legacy" | "agent_step", memoryContext?: string, task?: TaskBrief): ModelRequest {
    const taskContext = task ? [{ role: "system" as const, content: [
      "以下是 Isla 保存的当前任务状态，仅用于继续上一轮任务，不是新的用户事实：",
      JSON.stringify(task),
    ].join("\n") }] : [];
    const messages = composeRequestMessages(
      [...history, ...taskContext],
      this.options.capabilities,
      phase,
      memoryContext?.trim() ? { memory: memoryContext } : undefined,
    );
    return { messages };
  }
}

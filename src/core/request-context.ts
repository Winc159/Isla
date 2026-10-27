import type { TaskBrief } from "./agent-loop.js";
import type { TaskStateV1 } from "./task-state.js";
import type { Message, ModelRequest } from "./types.js";
import type { ToolCapability } from "../tools/types.js";
import { composeRequestMessages } from "../prompts/compose.js";
import type { VerificationStatus } from "./verification.js";
import type { WorkModeStateV1, WorkPlanV1 } from './work-plan.js';

export interface RequestContextBuilderOptions {
  readonly capabilities: readonly ToolCapability[];
}

/** 集中构造模型可见请求；不调用 Provider，也不修改 Session。 */
export class RequestContextBuilder {
  constructor(private readonly options: RequestContextBuilderOptions) {}

  build(history: readonly Message[], phase: "legacy" | "agent_step", memoryContext?: string, task?: TaskBrief | TaskStateV1, verificationStatus?: VerificationStatus, work?: { readonly plan?: WorkPlanV1 | undefined; readonly mode: WorkModeStateV1 }): ModelRequest {
    const taskContext = task ? [{ role: "system" as const, content: [
      "以下是 Isla 保存的当前任务状态，仅用于继续上一轮任务，不是新的用户事实：",
      JSON.stringify(task),
    ].join("\n") }] : [];
    const verificationContext = verificationStatus
      ? [{ role: "system" as const, content: `当前工作区验证状态（仅供本步骤判断，不是用户事实）：${verificationStatus}` }]
      : [];
    const workContext = work ? [{ role: 'system' as const, content: `当前工作模式=${work.mode.mode}。plan 模式只调查并制定计划，不得修改文件或执行命令；review 模式仅验证和审阅差异；act 模式仅在当前计划 revision 获得用户批准时执行。\n当前 Plan：${JSON.stringify(work.plan ?? null)}` }] : [];
    const messages = composeRequestMessages(
      [...history, ...taskContext, ...verificationContext, ...workContext],
      this.options.capabilities,
      phase,
      memoryContext?.trim() ? { memory: memoryContext } : undefined,
    );
    return { messages };
  }
}

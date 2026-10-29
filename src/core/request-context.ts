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

/** Centralizes model-visible context without calling a Provider or mutating Session state. */
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
    const workContext = work ? [{ role: 'system' as const, content: [
      `当前工作模式=${work.mode.mode}。`,
      "plan 模式只调查并制定计划，不得修改文件或执行命令。需要执行的工作必须调用 propose_work_plan 提交目标、步骤类型 (inspect/change/verify/other) 和依赖；不要提供 planId、revision、step status 或证据，Runtime 会将新步骤全部置为 pending。有效计划会立即结束当前 Turn 并返回 needs_user；用户通过 CLI /plan approve、Host mode_set 或 Web UI 批准该 revision 后，才可在下一 Turn 执行。plan 模式下禁止调用 update_work_plan_progress。",
      "review 模式仅验证和审阅差异；act 模式仅在当前计划 revision 获得用户批准时执行。Act 中每一步开始/完成/阻塞都使用 update_work_plan_progress 更新单一步骤；change 步骤必须引用成功 write/edit Tool 的 ID，verify 步骤必须引用 purpose=verification 且通过的 callId。不能改变已批准计划的结构；若确需重规划，只能调用 propose_replan，等待 Runtime 切回 Plan，再提交新计划并等待用户重新批准。",
      `当前 Plan：${JSON.stringify(work.plan ?? null)}`,
    ].join("\n") }] : [];
    const messages = composeRequestMessages(
      [...history, ...taskContext, ...verificationContext, ...workContext],
      this.options.capabilities,
      phase,
      memoryContext?.trim() ? { memory: memoryContext } : undefined,
    );
    return { messages };
  }
}

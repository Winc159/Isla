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
    const workContext = work ? [{ role: 'system' as const, content: `当前工作模式=${work.mode.mode}。plan 模式只调查并制定计划，不得修改文件或执行命令；使用 update_work_plan(action=revise) 提交完整计划。Plan 中只有已实际完成且能引用成功 Tool Call ID 的只读调查步骤可标为 completed；新提出的 change/verify 步骤必须是 pending，严禁预先标记完成或伪造证据。每个成功工具结果末尾会显示 Evidence Tool Call ID；提交计划或进度时原样引用该 ID。review 模式仅验证和审阅差异；act 模式仅在当前计划 revision 获得用户批准时执行。Act 中每一步开始/完成/阻塞都使用 update_work_plan(action=progress, stepId, stepStatus) 更新单一步骤；change 步骤必须引用成功 write/edit Tool 的 ID，verify 步骤必须引用 purpose=verification 且通过的 callId。不能改变已批准计划的结构；若确需重规划，只能调用 propose_replan/等待 Runtime 切回 Plan，再提交新 revision 并等待用户重新批准。\n当前 Plan：${JSON.stringify(work.plan ?? null)}` }] : [];
    const messages = composeRequestMessages(
      [...history, ...taskContext, ...verificationContext, ...workContext],
      this.options.capabilities,
      phase,
      memoryContext?.trim() ? { memory: memoryContext } : undefined,
    );
    return { messages };
  }
}

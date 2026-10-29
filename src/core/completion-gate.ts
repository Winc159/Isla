export type CompletionRejectionReason =
  | "required_evidence_missing"
  | "tool_result_missing"
  | "approval_missing"
  | "active_tool"
  | "turn_cancelled"
  | "verification_missing_after_mutation"
  | "verification_failed_after_mutation"
  | "deliverable_missing"
  | "task_step_pending"
  | "contract_evidence_missing"
  | "unresolved_action_failure"
  | "plan_approval_required";

import type { VerificationStatus } from "./verification.js";
export type { VerificationStatus } from "./verification.js";

export interface CompletionGateInput {
  readonly requiredExternalEvidence?: boolean;
  readonly successfulExternalEvidence?: boolean;
  readonly toolCallIds?: readonly string[];
  readonly toolResultIds?: readonly string[];
  readonly activeToolCount?: number;
  readonly unapprovedActionCount?: number;
  readonly cancelled?: boolean;
  readonly verificationStatus?: VerificationStatus;
  readonly unresolvedActionFailure?: boolean;
  readonly planApprovalRequired?: boolean;
  readonly priorRejections?: readonly CompletionRejectionReason[];
  readonly contract?: { readonly status: "active" | "blocked" | "completed"; readonly deliverables: readonly string[]; readonly steps: readonly { readonly status: string }[]; readonly evidence: readonly unknown[] };
  readonly workPlan?: { readonly status: "active" | "blocked" | "completed"; readonly steps: readonly { readonly status: string; readonly evidenceCallIds?: readonly string[] }[] };
  readonly completedDeliverableCount?: number;
  readonly satisfiedContractEvidenceCount?: number;
}

export type CompletionGateResult =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reason: CompletionRejectionReason; readonly observation: string; readonly terminal?: "blocked" | "needs_user" };

const observations: Record<CompletionRejectionReason, string> = {
  required_evidence_missing: "[completion_rejected] 当前任务要求外部证据，但本 Turn 尚无成功 Web Evidence。请调用可用能力补充证据，或明确说明当前无法核实。",
  tool_result_missing: "[completion_rejected] 当前 Turn 存在未闭合的 Tool Call。请补充对应 Tool Result，或明确说明无法完成。",
  approval_missing: "[completion_rejected] 当前 Turn 存在尚未完成 Approval 的动作。请等待 Approval 结果后再结束。",
  active_tool: "[completion_rejected] 当前仍有 Tool 正在执行，不能结束 Turn。",
  turn_cancelled: "[completion_rejected] 当前 Turn 已取消，不能继续交付新的完成结果。",
  verification_missing_after_mutation: "[completion_rejected] 当前存在修改但尚未验证。请运行适用的测试、构建、类型检查或其他验证命令；如果确实没有适用检查，请明确说明未验证原因后再交付。",
  verification_failed_after_mutation: "[completion_rejected] 修改后的验证未通过。请读取验证结果，继续修复并重新运行验证，不要声称已经完成。",
  deliverable_missing: "[completion_rejected] 当前任务仍有未交付项。请完成或明确说明无法完成的交付物。",
  task_step_pending: "[completion_rejected] 当前任务仍有未完成步骤。请继续执行，或将阻塞原因写入任务状态。",
  contract_evidence_missing: "[completion_rejected] 当前任务的成功标准仍缺少证据。请补充工具/验证证据，或明确说明无法核实。",
  unresolved_action_failure: "[completion_rejected] 本 Turn 有文件修改或命令动作失败/被拒绝，尚未被后续成功动作恢复。请修复或验证该阻塞；不能报告任务完成。",
  plan_approval_required: "[needs_user] 当前工作计划尚未获用户批准。请先批准当前 Plan revision，再在后续 Turn 继续执行。",
};

export function evaluateCompletionGate(input: CompletionGateInput): CompletionGateResult {
  const callIds = new Set(input.toolCallIds ?? []);
  const resultIds = new Set(input.toolResultIds ?? []);
  const reason = input.cancelled
    ? "turn_cancelled"
    : (input.activeToolCount ?? 0) > 0
      ? "active_tool"
      : (input.unapprovedActionCount ?? 0) > 0
        ? "approval_missing"
        : [...callIds].some(id => !resultIds.has(id))
          ? "tool_result_missing"
          : input.requiredExternalEvidence && !input.successfulExternalEvidence
          ? "required_evidence_missing"
          : input.unresolvedActionFailure
            ? "unresolved_action_failure"
            : input.planApprovalRequired
              ? "plan_approval_required"
              : input.verificationStatus === "not_run"
              ? "verification_missing_after_mutation"
              : input.verificationStatus === "failed_after_last_change"
                ? "verification_failed_after_mutation"
                : input.workPlan && input.workPlan.status !== "blocked" && (input.workPlan.status !== "completed" || input.workPlan.steps.some(step => step.status !== "completed" || !step.evidenceCallIds?.length))
                  ? "task_step_pending"
                  : input.contract && input.contract.status === "active" && input.contract.steps.some(step => step.status !== "completed")
                  ? "task_step_pending"
                  : input.contract && input.contract.status === "active" && input.contract.deliverables.length > (input.completedDeliverableCount ?? 0)
                    ? "deliverable_missing"
                    : input.contract && input.contract.status === "active" && input.contract.evidence.length > (input.satisfiedContractEvidenceCount ?? 0)
                      ? "contract_evidence_missing"
                      : undefined;
  if (!reason) return { accepted: true };
  if (reason === "plan_approval_required") return { accepted: false, reason, observation: observations[reason], terminal: "needs_user" };
  const repeated = (input.priorRejections ?? []).filter(item => item === reason).length > 0;
  return { accepted: false, reason, observation: observations[reason], ...(repeated ? { terminal: "blocked" as const } : {}) };
}

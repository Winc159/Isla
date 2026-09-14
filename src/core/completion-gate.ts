export type CompletionRejectionReason =
  | "required_evidence_missing"
  | "tool_result_missing"
  | "approval_missing"
  | "active_tool"
  | "turn_cancelled";

export interface CompletionGateInput {
  readonly requiredExternalEvidence?: boolean;
  readonly successfulExternalEvidence?: boolean;
  readonly toolCallIds?: readonly string[];
  readonly toolResultIds?: readonly string[];
  readonly activeToolCount?: number;
  readonly unapprovedActionCount?: number;
  readonly cancelled?: boolean;
  readonly priorRejections?: readonly CompletionRejectionReason[];
}

export type CompletionGateResult =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reason: CompletionRejectionReason; readonly observation: string; readonly terminal?: "blocked" };

const observations: Record<CompletionRejectionReason, string> = {
  required_evidence_missing: "[completion_rejected] 当前任务要求外部证据，但本 Turn 尚无成功 Web Evidence。请调用可用能力补充证据，或明确说明当前无法核实。",
  tool_result_missing: "[completion_rejected] 当前 Turn 存在未闭合的 Tool Call。请补充对应 Tool Result，或明确说明无法完成。",
  approval_missing: "[completion_rejected] 当前 Turn 存在尚未完成 Approval 的动作。请等待 Approval 结果后再结束。",
  active_tool: "[completion_rejected] 当前仍有 Tool 正在执行，不能结束 Turn。",
  turn_cancelled: "[completion_rejected] 当前 Turn 已取消，不能继续交付新的完成结果。",
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
            : undefined;
  if (!reason) return { accepted: true };
  const repeated = (input.priorRejections ?? []).filter(item => item === reason).length > 0;
  return { accepted: false, reason, observation: observations[reason], ...(repeated ? { terminal: "blocked" as const } : {}) };
}

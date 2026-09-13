import type { ApprovalDecision, ApprovalRequest, ApprovalRequestOptions, ApprovalService } from "../approval/types.js";
import type { ProtocolRequest } from "./types.js";
export class ProtocolApprovalService implements ApprovalService {
  private sequence = 0;
  private readonly remembered = new Set<string>();
  private pending: { readonly approvalId: string; readonly resolve: (decision: ApprovalDecision, remember: boolean) => void } | undefined;
  private closed = false;
  constructor(private readonly emit: (approvalId: string, request: ApprovalRequest) => void) {}
  async request(request: ApprovalRequest, options: ApprovalRequestOptions = {}): Promise<ApprovalDecision> {
    if (options.signal?.aborted) return { approved: false, reason: "当前回合已取消。" };
    if (this.closed) return { approved: false, reason: "协议输入已结束" };
    const key = `${request.toolName}:${request.permission.kind}`;
    if (this.remembered.has(key)) return { approved: true };
    const approvalId = `approval-${++this.sequence}`;
    this.emit(approvalId, request);
    return await new Promise<ApprovalDecision>(resolve => {
      const onAbort = () => { if (this.pending?.approvalId === approvalId) { this.pending = undefined; resolve({ approved: false, reason: "当前回合已取消。" }); } };
      options.signal?.addEventListener("abort", onAbort, { once: true });
      this.pending = { approvalId, resolve: (decision, remember) => {
        options.signal?.removeEventListener("abort", onAbort);
        if (decision.approved && remember) this.remembered.add(key);
        resolve(decision);
      }};
      if (options.signal?.aborted) onAbort();
    });
  }
  resolve(response: Extract<ProtocolRequest, { type: "approval_response" }>): boolean {
    if (!this.pending || this.pending.approvalId !== response.approvalId) return false;
    const pending = this.pending;
    this.pending = undefined;
    pending.resolve(response.approved ? { approved: true } : { approved: false, reason: "用户拒绝了工具调用" }, response.remember === true);
    return true;
  }
  rejectPending(reason = "协议输入已结束"): void {
    this.closed = true;
    const pending = this.pending;
    this.pending = undefined;
    pending?.resolve({ approved: false, reason }, false);
  }
  resetRemembered(): void {
    this.remembered.clear();
  }
  reopen(): void {
    this.closed = false;
  }
}

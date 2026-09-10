import type { ApprovalDecision, ApprovalRequest, ApprovalService } from "../approval/types.js";
import type { ProtocolRequest } from "./types.js";
export class ProtocolApprovalService implements ApprovalService {
  private sequence = 0;
  private readonly remembered = new Set<string>();
  constructor(private readonly wait: () => Promise<ProtocolRequest>, private readonly emit: (approvalId: string, request: ApprovalRequest) => void) {}
  async request(request: ApprovalRequest): Promise<ApprovalDecision> {
    const key = `${request.toolName}:${request.permission.kind}`;
    if (this.remembered.has(key)) return { approved: true };
    const approvalId = `approval-${++this.sequence}`;
    this.emit(approvalId, request);
    const response = await this.wait();
    if (response.type !== "approval_response" || response.approvalId !== approvalId) return { approved: false, reason: "审批响应不匹配" };
    if (response.approved && response.remember) this.remembered.add(key);
    return response.approved ? { approved: true } : { approved: false, reason: "用户拒绝了工具调用" };
  }
}

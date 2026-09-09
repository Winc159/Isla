import type { ApprovalService, ApprovalRequest, ApprovalDecision } from "./types.js";

export class CallbackApprovalService implements ApprovalService {
  constructor(private readonly callback: (request: ApprovalRequest) => Promise<ApprovalDecision>) {}
  request(request: ApprovalRequest): Promise<ApprovalDecision> { return this.callback(request); }
}

export const denyApproval: ApprovalService = { request: async () => ({ approved: false, reason: "Approval is unavailable" }) };

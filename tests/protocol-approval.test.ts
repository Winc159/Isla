import { describe, expect, it } from "vitest";
import { ProtocolApprovalService } from "../src/protocol/approval.js";

describe("ProtocolApprovalService", () => {
  it("waits for the matching response and supports remember", async () => {
    const requests: string[] = [];
    const service = new ProtocolApprovalService((approvalId) => requests.push(approvalId));
    const pending = service.request({ toolName: "write_text_file", permission: { kind: "filesystem-write" }, summary: "write" });
    await Promise.resolve();
    expect(requests).toEqual(["approval-1"]);
    expect(service.resolve({ type: "approval_response", id: "a1", approvalId: "approval-1", approved: true, remember: true })).toBe(true);
    await expect(pending).resolves.toEqual({ approved: true });
    await expect(service.request({ toolName: "write_text_file", permission: { kind: "filesystem-write" }, summary: "write" })).resolves.toEqual({ approved: true });
  });

  it("rejects mismatched responses without resolving the active approval", async () => {
    const service = new ProtocolApprovalService(() => {});
    const pending = service.request({ toolName: "write_text_file", permission: { kind: "filesystem-write" }, summary: "write" });
    await Promise.resolve();
    expect(service.resolve({ type: "approval_response", id: "a1", approvalId: "other", approved: true })).toBe(false);
    service.rejectPending("EOF");
    await expect(pending).resolves.toEqual({ approved: false, reason: "EOF" });
  });

  it("rejects approvals created after protocol shutdown", async () => {
    const service = new ProtocolApprovalService(() => {});
    service.rejectPending("exit");
    await expect(service.request({ toolName: "write_text_file", permission: { kind: "filesystem-write" }, summary: "write" })).resolves.toEqual({ approved: false, reason: "协议输入已结束" });
  });

  it("settles a pending approval when its signal is aborted", async () => {
    const service = new ProtocolApprovalService(() => {});
    const controller = new AbortController();
    const pending = service.request({ toolName: "write_text_file", permission: { kind: "filesystem-write" }, summary: "write" }, { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    await expect(pending).resolves.toEqual({ approved: false, reason: "当前回合已取消。" });
    expect(service.resolve({ type: "approval_response", id: "a1", approvalId: "approval-1", approved: true })).toBe(false);
  });
});

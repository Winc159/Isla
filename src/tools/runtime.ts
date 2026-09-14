import type { ToolCall } from "../core/types.js";
import type { ToolRegistry } from "./registry.js";
import type { ToolExecutionResult, ToolOutput } from "./types.js";
import type { ApprovalPolicy, ApprovalRequestOptions, ApprovalService } from "../approval/types.js";
import { allowsWithoutApproval, type PermissionPreset } from "../approval/presets.js";
import { ToolFailure } from "./errors.js";

export class ToolRuntime {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly options: { readonly approvalPolicy?: ApprovalPolicy | undefined; readonly approvalService?: ApprovalService | undefined; readonly permissionPreset?: PermissionPreset | undefined; readonly onApproved?: ((toolName: string) => void) | undefined } = {},
  ) {}
  async execute(call: ToolCall, options: { readonly signal?: AbortSignal; readonly webFetchAllowedUrls?: readonly string[] } = {}): Promise<ToolExecutionResult> {
    if (options.signal?.aborted) return cancelledResult();
    const tool = this.registry.get(call.name);
    if (!tool) return { ok: false, code: "UNKNOWN_TOOL", message: `Unknown tool: ${call.name}` };
    let summary = `Execute ${call.name}`;
    try {
      if (tool.describe) summary = await tool.describe(call.arguments, options);
      if (options.signal?.aborted) return cancelledResult();
    } catch (error) {
      if (options.signal?.aborted) return cancelledResult();
      return normalizeToolFailure(error);
    }
    const permission = tool.permission ?? { kind: "none" as const };
    if (permission.kind !== "none" && !allowsWithoutApproval(this.options.permissionPreset ?? "readonly", permission)) {
      const policy = this.options.approvalPolicy ?? "never";
      if (policy === "never") return { ok: false, code: "PERMISSION_DENIED", message: "Tool permission denied by policy" };
      if (policy === "ask") {
        const decision = this.options.approvalService
          ? await this.options.approvalService.request({ toolName: call.name, permission, summary }, options as ApprovalRequestOptions)
          : { approved: false as const, reason: "Approval service is unavailable" };
        if (!decision.approved) return decision.reason === "当前回合已取消。" ? cancelledResult() : { ok: false, code: "USER_REJECTED", message: decision.reason ?? "User rejected the tool call" };
      }
    }
    if (options.signal?.aborted) return cancelledResult();
    this.options.onApproved?.(call.name);
    try {
      const result = await tool.execute(call.arguments, options);
      if (options.signal?.aborted) return cancelledResult();
      return normalizeToolSuccess(result);
    } catch (error) {
      if (options.signal?.aborted) return cancelledResult();
      return normalizeToolFailure(error);
    }
  }
}

function cancelledResult(): Extract<ToolExecutionResult, { readonly ok: false }> {
  return { ok: false, code: "TURN_CANCELLED", message: "当前回合已取消。" };
}

function normalizeToolSuccess(output: string | ToolOutput): Extract<ToolExecutionResult, { readonly ok: true }> {
  return typeof output === "string" ? { ok: true, content: output } : { ok: true, content: output.content, ...(output.details ? { details: output.details } : {}) };
}

function normalizeToolFailure(error: unknown): ToolExecutionResult {
  if (error instanceof ToolFailure) return { ok: false, code: error.code, message: error.message };
  return { ok: false, code: "EXECUTION_FAILED", message: error instanceof Error ? error.message : String(error) };
}

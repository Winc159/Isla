import type { ToolCall } from "../core/types.js";
import type { ToolRegistry } from "./registry.js";
import type { ToolExecutionResult, ToolOutput } from "./types.js";
import type { ApprovalPolicy, ApprovalService } from "../approval/types.js";
import { allowsWithoutApproval, type PermissionPreset } from "../approval/presets.js";
import { ToolFailure } from "./errors.js";

export class ToolRuntime {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly options: { readonly approvalPolicy?: ApprovalPolicy | undefined; readonly approvalService?: ApprovalService | undefined; readonly permissionPreset?: PermissionPreset | undefined; readonly onApproved?: ((toolName: string) => void) | undefined } = {},
  ) {}
  async execute(call: ToolCall): Promise<ToolExecutionResult> {
    const tool = this.registry.get(call.name);
    if (!tool) return { ok: false, code: "UNKNOWN_TOOL", message: `Unknown tool: ${call.name}` };
    let summary = `Execute ${call.name}`;
    try {
      if (tool.describe) summary = await tool.describe(call.arguments);
    } catch (error) {
      return normalizeToolFailure(error);
    }
    const permission = tool.permission ?? { kind: "none" as const };
    if (permission.kind !== "none" && !allowsWithoutApproval(this.options.permissionPreset ?? "readonly", permission)) {
      const policy = this.options.approvalPolicy ?? "never";
      if (policy === "never") return { ok: false, code: "PERMISSION_DENIED", message: "Tool permission denied by policy" };
      if (policy === "ask") {
        const decision = this.options.approvalService
          ? await this.options.approvalService.request({ toolName: call.name, permission, summary })
          : { approved: false as const, reason: "Approval service is unavailable" };
        if (!decision.approved) return { ok: false, code: "USER_REJECTED", message: decision.reason ?? "User rejected the tool call" };
      }
    }
    this.options.onApproved?.(call.name);
    try {
      return normalizeToolSuccess(await tool.execute(call.arguments));
    } catch (error) {
      return normalizeToolFailure(error);
    }
  }
}

function normalizeToolSuccess(output: string | ToolOutput): Extract<ToolExecutionResult, { readonly ok: true }> {
  return typeof output === "string" ? { ok: true, content: output } : { ok: true, content: output.content, ...(output.details ? { details: output.details } : {}) };
}

function normalizeToolFailure(error: unknown): ToolExecutionResult {
  if (error instanceof ToolFailure) return { ok: false, code: error.code, message: error.message };
  return { ok: false, code: "EXECUTION_FAILED", message: error instanceof Error ? error.message : String(error) };
}

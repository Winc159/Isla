import type { ToolCall } from "../core/types.js";
import type { ToolRegistry } from "./registry.js";
import type { ToolExecutionResult, ToolOutput } from "./types.js";
import type { ApprovalPolicy, ApprovalRequestOptions, ApprovalService } from "../approval/types.js";
import { allowsWithoutApproval, type PermissionPreset } from "../approval/presets.js";
import { ToolFailure } from "./errors.js";
import { evaluatePolicy, type PolicyRuleV1 } from '../approval/policy.js';

export class ToolRuntime {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly options: { readonly approvalPolicy?: ApprovalPolicy | undefined; readonly approvalService?: ApprovalService | undefined; readonly permissionPreset?: PermissionPreset | undefined; readonly onApproved?: ((toolName: string) => void) | undefined; readonly policyRules?: readonly PolicyRuleV1[]; readonly workspace?: string } = {},
  ) {}
  async execute(call: ToolCall, options: { readonly signal?: AbortSignal; readonly webFetchAllowedUrls?: readonly string[]; readonly toolCallId?: string } = {}): Promise<ToolExecutionResult> {
    if (options.signal?.aborted) return cancelledResult();
    const tool = this.registry.get(call.name);
    if (!tool) return { ok: false, code: "UNKNOWN_TOOL", message: `Unknown tool: ${call.name}` };
    let summary = `Execute ${call.name}`;
    let networkHost: string | undefined;
    try {
      if (tool.describe) summary = await tool.describe(call.arguments, options);
      networkHost = tool.policyContext?.(call.arguments).networkHost;
      if (networkHost && !summary.toLowerCase().includes(networkHost)) summary = `${summary} (host: ${networkHost})`;
      if (options.signal?.aborted) return cancelledResult();
    } catch (error) {
      if (options.signal?.aborted) return cancelledResult();
      return normalizeToolFailure(error);
    }
    const permissions = tool.permission === undefined ? [] : Array.isArray(tool.permission) ? tool.permission : [tool.permission];
    for (const permission of permissions) {
      if (permission.kind === "none" || allowsWithoutApproval(this.options.permissionPreset ?? "readonly", permission)) continue;
      const extracted = { ...extractCommandPolicy(call.name, call.arguments), ...(networkHost ? { networkHost } : {}) };
      const policyMatch = evaluatePolicy(this.options.policyRules ?? [], { permission, tool: call.name, workspace: this.options.workspace ?? '', ...extracted });
      if (policyMatch.effect === 'deny') return { ok: false, code: "PERMISSION_DENIED", message: "Tool permission denied by approval rule" };
      const policy = policyMatch.effect === 'allow' ? 'always' : this.options.approvalPolicy ?? "never";
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
      const result = await tool.execute(call.arguments, { ...options, toolCallId: call.id });
      if (options.signal?.aborted) return cancelledResult();
      return normalizeToolSuccess(result);
    } catch (error) {
      if (options.signal?.aborted) return cancelledResult();
      return normalizeToolFailure(error);
    }
  }
}

function extractCommandPolicy(toolName: string, argumentsJson: string): { readonly argv?: readonly string[]; readonly workspace?: string } {
  if (toolName !== 'run_command' && toolName !== 'exec_start') return {};
  try {
    const value: unknown = JSON.parse(argumentsJson);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const record = value as Record<string, unknown>;
    if (typeof record.executable !== 'string' || !Array.isArray(record.argv) || !record.argv.every(item => typeof item === 'string')) return {};
    return { argv: [record.executable, ...record.argv as string[]] };
  } catch { return {}; }
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

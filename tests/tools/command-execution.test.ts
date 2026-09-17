import { describe, expect, it } from "vitest";
import { createRunCommandTool } from "../../src/tools/command-execution.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import { ToolRuntime } from "../../src/tools/runtime.js";

describe("run_command tool", () => {
  it("returns separated output and structured execution details", async () => {
    const tool = createRunCommandTool(process.cwd());
    const result = await tool.execute(JSON.stringify({ command: "Write-Output ok; Write-Error warning; exit 2" }));
    expect(result).toMatchObject({ details: { type: "command_execution", exitCode: 2 }, content: expect.stringContaining("ok") });
    expect(result.content).toContain("warning");
  });
  it("requires approval metadata and redacts command previews", async () => {
    const tool = createRunCommandTool(process.cwd());
    expect(tool.permission).toEqual({ kind: "command-execute" });
    expect(tool.describe?.(JSON.stringify({ command: "set API_KEY=secret" }))).toContain("<redacted>");
  });
  it("maps workdir errors to sandbox denial", async () => {
    const tool = createRunCommandTool(process.cwd());
    await expect(tool.execute(JSON.stringify({ command: "Write-Output x", workdir: ".." }))).rejects.toMatchObject({ code: "SANDBOX_DENIED" });
  });

  it("requires Approval before starting the command", async () => {
    const registry = new ToolRegistry();
    registry.register(createRunCommandTool(process.cwd()));
    let summary = "";
    const runtime = new ToolRuntime(registry, {
      approvalPolicy: "ask",
      permissionPreset: "workspace",
      approvalService: { request: async request => { summary = request.summary; return { approved: false, reason: "拒绝执行" }; } },
    });
    await expect(runtime.execute({ id: "1", name: "run_command", arguments: JSON.stringify({ command: "Write-Output should-not-run" }) })).resolves.toMatchObject({ ok: false, code: "USER_REJECTED" });
    expect(summary).toContain("should-not-run");
  });
});

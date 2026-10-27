import { describe, expect, it } from "vitest";
import { createRunCommandTool } from "../../src/tools/command-execution.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import { ToolRuntime } from "../../src/tools/runtime.js";
import { execPath } from "node:process";
import { ExecutionProcessRegistry } from "../../src/tools/process-registry.js";
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe("run_command tool", () => {
  it("accepts executable and argv without shell interpretation", async () => {
    const tool = createRunCommandTool(process.cwd());
    const result = await tool.execute(JSON.stringify({ executable: execPath, argv: ["-e", "process.stdout.write(process.argv[1])", "a;b"] }));
    expect(result.content).toContain("a;b");
    expect(result.details).toMatchObject({ shell: "direct", exitCode: 0 });
  });
  it("routes argv compatibility calls through the managed process registry", async () => {
    const registry = new ExecutionProcessRegistry();
    try {
      const tool = createRunCommandTool(process.cwd(), registry, () => 'compat-session');
      const result = await tool.execute(JSON.stringify({ executable: execPath, argv: ["-e", "process.stdout.write('runtime')"] }));
      expect(result.content).toContain('runtime');
      expect(result.details).toMatchObject({ type: 'command_execution', shell: 'direct', exitCode: 0 });
    } finally { await registry.close(); }
  });
  it("returns separated output and structured execution details", async () => {
    const tool = createRunCommandTool(process.cwd());
    const result = await tool.execute(JSON.stringify({ command: "Write-Output ok; Write-Error warning; exit 2" }));
    expect(result).toMatchObject({ details: { type: "command_execution", exitCode: 2 }, content: expect.stringContaining("ok") });
    expect(result.content).toContain("warning");
  });
  it("preserves verification purpose in structured details", async () => {
    const tool = createRunCommandTool(process.cwd());
    const result = await tool.execute(JSON.stringify({ command: "Write-Output check", purpose: "verification" }));
    expect(result).toMatchObject({ details: { type: "command_execution", purpose: "verification", exitCode: 0 } });
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
  it("rejects workdir symlinks that escape the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), 'isla-command-root-'));
    const outside = await mkdtemp(join(tmpdir(), 'isla-command-outside-'));
    const link = join(root, '.command-workdir-escape');
    try {
      await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
      const tool = createRunCommandTool(root);
      await expect(tool.execute(JSON.stringify({ executable: execPath, argv: ['--version'], workdir: '.command-workdir-escape' }))).rejects.toMatchObject({ code: 'SANDBOX_DENIED' });
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
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

import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../../src/tools/registry.js";
import { ToolRuntime } from "../../src/tools/runtime.js";
import { sandboxDenied } from "../../src/tools/errors.js";

describe("ToolRuntime", () => {
  it("normalizes success and unknown tools", async () => {
    const registry = new ToolRegistry();
    registry.register({ definition: { name: "echo", description: "", parameters: {} }, execute: async () => "ok" });
    const runtime = new ToolRuntime(registry);
    await expect(runtime.execute({ id: "1", name: "echo", arguments: "{}" })).resolves.toEqual({ ok: true, content: "ok" });
    await expect(runtime.execute({ id: "2", name: "missing", arguments: "{}" })).resolves.toMatchObject({ ok: false, code: "UNKNOWN_TOOL" });
  });

  it("preserves structured success details", async () => {
    const registry = new ToolRegistry();
    registry.register({ definition: { name: "structured", description: "", parameters: {} }, execute: async () => ({ content: "reference", details: { type: "project_search", sources: [{ id: `project:v1:${"a".repeat(64)}`, path: "docs/a.md", startLine: 2, endLine: 3 }], filesScanned: 1, truncated: false } }) });
    await expect(new ToolRuntime(registry).execute({ id: "1", name: "structured", arguments: "{}" })).resolves.toMatchObject({ ok: true, content: "reference", details: { type: "project_search", filesScanned: 1 } });
  });

  it("normalizes execution failures", async () => {
    const registry = new ToolRegistry();
    registry.register({ definition: { name: "bad", description: "", parameters: {} }, execute: async () => { throw new Error("disk unavailable"); } });
    await expect(new ToolRuntime(registry).execute({ id: "1", name: "bad", arguments: "{}" })).resolves.toEqual({ ok: false, code: "EXECUTION_FAILED", message: "disk unavailable" });
  });

  it("preserves sandbox denial as a structured error", async () => {
    const registry = new ToolRegistry();
    registry.register({ definition: { name: "read", description: "", parameters: {} }, execute: async () => { throw sandboxDenied("outside root"); } });
    await expect(new ToolRuntime(registry).execute({ id: "1", name: "read", arguments: "{}" })).resolves.toEqual({ ok: false, code: "SANDBOX_DENIED", message: "outside root" });
  });

  it("applies approval policy before execution", async () => {
    const registry = new ToolRegistry();
    let executed = false;
    registry.register({ definition: { name: "write", description: "", parameters: {} }, permission: { kind: "filesystem-write" }, execute: async () => { executed = true; return "written"; } });
    const runtime = new ToolRuntime(registry, { approvalPolicy: "ask", approvalService: { request: async () => ({ approved: false, reason: "no" }) }, permissionPreset: "workspace" });
    await expect(runtime.execute({ id: "1", name: "write", arguments: "{}" })).resolves.toMatchObject({ ok: false, code: "USER_REJECTED" });
    expect(executed).toBe(false);
  });

  it("validates and describes an action before requesting approval", async () => {
    const registry = new ToolRegistry();
    let summary = "";
    registry.register({
      definition: { name: "write", description: "", parameters: {} },
      permission: { kind: "filesystem-write" },
      describe: async () => "覆盖 notes.txt；3 个字符；内容预览：new",
      execute: async () => "written",
    });
    const runtime = new ToolRuntime(registry, {
      approvalPolicy: "ask",
      permissionPreset: "workspace",
      approvalService: { request: async request => { summary = request.summary; return { approved: false }; } },
    });
    await runtime.execute({ id: "1", name: "write", arguments: "{}" });
    expect(summary).toContain("覆盖 notes.txt");
  });

  it("allows reads without approval in workspace preset", async () => {
    const registry = new ToolRegistry();
    registry.register({ definition: { name: "read", description: "", parameters: {} }, permission: { kind: "filesystem-read" }, execute: async () => "read" });
    await expect(new ToolRuntime(registry, { approvalPolicy: "ask", permissionPreset: "workspace" }).execute({ id: "1", name: "read", arguments: "{}" })).resolves.toEqual({ ok: true, content: "read" });
  });
});

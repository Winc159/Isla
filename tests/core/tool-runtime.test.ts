import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../../src/tools/registry.js";
import { ToolRuntime } from "../../src/tools/runtime.js";

describe("ToolRuntime", () => {
  it("normalizes success and unknown tools", async () => {
    const registry = new ToolRegistry();
    registry.register({ definition: { name: "echo", description: "", parameters: {} }, execute: async () => "ok" });
    const runtime = new ToolRuntime(registry);
    await expect(runtime.execute({ id: "1", name: "echo", arguments: "{}" })).resolves.toEqual({ ok: true, content: "ok" });
    await expect(runtime.execute({ id: "2", name: "missing", arguments: "{}" })).resolves.toMatchObject({ ok: false, code: "UNKNOWN_TOOL" });
  });

  it("normalizes execution failures", async () => {
    const registry = new ToolRegistry();
    registry.register({ definition: { name: "bad", description: "", parameters: {} }, execute: async () => { throw new Error("disk unavailable"); } });
    await expect(new ToolRuntime(registry).execute({ id: "1", name: "bad", arguments: "{}" })).resolves.toEqual({ ok: false, code: "EXECUTION_FAILED", message: "disk unavailable" });
  });

  it("applies approval policy before execution", async () => {
    const registry = new ToolRegistry();
    let executed = false;
    registry.register({ definition: { name: "write", description: "", parameters: {} }, permission: { kind: "filesystem-write" }, execute: async () => { executed = true; return "written"; } });
    const runtime = new ToolRuntime(registry, { approvalPolicy: "ask", approvalService: { request: async () => ({ approved: false, reason: "no" }) }, permissionPreset: "workspace" });
    await expect(runtime.execute({ id: "1", name: "write", arguments: "{}" })).resolves.toMatchObject({ ok: false, code: "USER_REJECTED" });
    expect(executed).toBe(false);
  });

  it("allows reads without approval in workspace preset", async () => {
    const registry = new ToolRegistry();
    registry.register({ definition: { name: "read", description: "", parameters: {} }, permission: { kind: "filesystem-read" }, execute: async () => "read" });
    await expect(new ToolRuntime(registry, { approvalPolicy: "ask", permissionPreset: "workspace" }).execute({ id: "1", name: "read", arguments: "{}" })).resolves.toEqual({ ok: true, content: "read" });
  });
});

import { describe, expect, it } from "vitest";
import { probeExternalTool, RESOURCE_EXTERNAL_TOOLS } from "../../src/resource/external-tools.js";
describe("Resource external tool probes", () => {
  it("uses the first successful command and sanitizes version output", async () => { const report = await probeExternalTool({ id: "fixture", commands: ["missing", "working"], versionArgs: ["--version"], required: true }, async command => command === "working" ? { code: 0, stdout: "tool\nversion 1.2.3\n", stderr: "" } : { code: 1, stdout: "", stderr: "missing" }); expect(report).toMatchObject({ id: "fixture", status: "available", command: "working", version: "tool version 1.2.3" }); });
  it("reports missing tools without exposing command errors", async () => { const report = await probeExternalTool(RESOURCE_EXTERNAL_TOOLS[1]!, async () => { throw new Error("private path or token"); }); expect(report).toEqual({ id: "archive-rar-fallback", status: "missing", reason: "没有找到可执行的候选命令" }); });
});

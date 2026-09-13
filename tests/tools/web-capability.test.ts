import { describe, expect, it } from "vitest";
import { createWebFetchCapability } from "../../src/tools/web.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import { ToolRuntime } from "../../src/tools/runtime.js";

describe("web capability", () => {
  it("contains one network-protected web_fetch tool and untrusted-data guidance", () => {
    const capability = createWebFetchCapability({ enabled: true, allowedHosts: ["docs.example.com"], timeoutMs: 30_000, maxResponseBytes: 1_000_000, maxBodyChars: 60_000, maxOutputChars: 80_000, maxRedirects: 3 });
    expect(capability.id).toBe("web");
    expect(capability.instructions).toContain("不可信");
    expect(capability.tools).toHaveLength(1);
    expect(capability.tools[0]?.definition.name).toBe("web_fetch");
    expect(capability.tools[0]?.permission).toEqual({ kind: "network" });
  });

  it("keeps network permission outside readonly/workspace auto-allow", async () => {
    const tool = createWebFetchCapability({ enabled: true, allowedHosts: ["docs.example.com"], timeoutMs: 30_000, maxResponseBytes: 1_000_000, maxBodyChars: 60_000, maxOutputChars: 80_000, maxRedirects: 3 }).tools[0]!;
    const registry = new ToolRegistry();
    registry.register(tool);
    await expect(new ToolRuntime(registry, { approvalPolicy: "never", permissionPreset: "workspace" }).execute({ id: "1", name: "web_fetch", arguments: JSON.stringify({ url: "https://docs.example.com" }) })).resolves.toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
  });
});

import { describe, expect, it } from "vitest";
import { createWebCapability, createWebFetchCapability } from "../../src/tools/web.js";
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

  it("composes search and fetch independently", () => {
    const capability = createWebCapability({ webSearch: { enabled: true, provider: "deepseek-official", apiKey: "test-only-key", model: "search-model", maxResults: 8, timeoutMs: 30_000, maxOutputChars: 12_000 } });
    expect(capability.tools.map(tool => tool.definition.name)).toEqual(["web_search"]);
    expect(capability.instructions).toContain("web_search");
    const both = createWebCapability({
      webSearch: { enabled: true, provider: "deepseek-official", apiKey: "test-only-key", model: "search-model", maxResults: 8, timeoutMs: 30_000, maxOutputChars: 12_000 },
      webFetch: { enabled: true, allowedHosts: ["docs.example.com"], timeoutMs: 30_000, maxResponseBytes: 1_000_000, maxBodyChars: 60_000, maxOutputChars: 80_000, maxRedirects: 3 },
    });
    expect(both.tools.map(tool => tool.definition.name)).toEqual(["web_fetch", "web_search"]);
  });
});

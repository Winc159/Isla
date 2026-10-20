import { describe, expect, it } from "vitest";

describe("v0.5.1 Worker production gaps", () => {
  it("exposes a Resource-to-Host structured inference client", async () => {
    const module = await import("../../src/resource/inference-client.js").catch(() => undefined);
    expect(module).toBeDefined();
  });

  it("assembles the configured worker Provider into the normal Host startup path", async () => {
    const module = await import("../../src/main.js");
    expect("createWorkerRuntimeBinding" in module).toBe(true);
  });
});

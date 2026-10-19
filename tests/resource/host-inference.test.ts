import { afterEach, describe, expect, it } from "vitest";
import { ResidentHost } from "../../src/host.js";
import type { SessionStore } from "../../src/session-store.js";

const store = { list: async () => [], listAll: async () => [], loadLatest: async () => undefined, create: async () => { throw new Error("unused"); }, save: async session => session } as unknown as SessionStore;
let host: ResidentHost | undefined;
afterEach(async () => { await host?.close(); host = undefined; });

describe("ResidentHost structured inference route", () => {
  it("authenticates and forwards the worker request", async () => {
    host = new ResidentHost({ host: "127.0.0.1", port: 0, token: "host-token", provider: "fake", model: "primary", sessionStore: store, createSession: () => ({}) as never, structuredInference: async request => ({ requestId: request.requestId, status: "succeeded", output: { ok: true }, model: { role: "resource-worker", profile: "worker", provider: "fake", model: "worker", configRevision: "rev" } }) });
    const address = await host.start();
    const response = await fetch(`http://${address.host}:${address.port}/api/v1/inference/structured`, { method: "POST", headers: { authorization: "Bearer host-token", "content-type": "application/json" }, body: JSON.stringify({ requestId: "req", role: "resource-worker", task: "resource.suggest-title", schema: "resource.title-result.v1", input: {} }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ requestId: "req", status: "succeeded" });
  });

  it("returns a stable error when worker is not configured", async () => {
    host = new ResidentHost({ host: "127.0.0.1", port: 0, token: "host-token", provider: "fake", model: "primary", sessionStore: store, createSession: () => ({}) as never });
    const address = await host.start();
    const response = await fetch(`http://${address.host}:${address.port}/api/v1/inference/structured`, { method: "POST", headers: { authorization: "Bearer host-token", "content-type": "application/json" }, body: "{}" });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "ROLE_NOT_CONFIGURED", retryable: false } });
  });
});

import { describe, expect, it } from "vitest";
import { AgentRegistry, RuntimeScope, ServiceRegistry, serviceKey } from "../../src/core/service-kernel.js";

describe("service kernel", () => {
  it("starts dependencies first and closes services in reverse order", async () => {
    const events: string[] = [];
    const database = serviceKey<{ ready: true }>("database");
    const agent = serviceKey<{ databaseReady: boolean }>("agent");
    const registry = new ServiceRegistry();
    registry.register({ key: agent, required: [database], start: context => { events.push("start-agent"); return { databaseReady: context.get(database).ready }; }, stop: () => { events.push("stop-agent"); } });
    registry.register({ key: database, start: () => { events.push("start-database"); return { ready: true as const }; }, stop: () => { events.push("stop-database"); } });
    await registry.start();
    expect(registry.get(agent).databaseReady).toBe(true);
    await registry.close();
    expect(events).toEqual(["start-database", "start-agent", "stop-agent", "stop-database"]);
  });

  it("rejects missing and cyclic dependencies", async () => {
    const missing = serviceKey<unknown>("missing");
    const one = serviceKey<unknown>("one");
    const two = serviceKey<unknown>("two");
    const absent = new ServiceRegistry();
    absent.register({ key: one, required: [missing], start: () => ({}) });
    await expect(absent.start()).rejects.toThrow("SERVICE_REQUIRED_MISSING:missing");
    const cyclic = new ServiceRegistry();
    cyclic.register({ key: one, required: [two], start: () => ({}) });
    cyclic.register({ key: two, required: [one], start: () => ({}) });
    await expect(cyclic.start()).rejects.toThrow("SERVICE_DEPENDENCY_CYCLE:one");
  });

  it("rolls back started services when a later service fails", async () => {
    const events: string[] = [];
    const one = serviceKey<unknown>("one");
    const two = serviceKey<unknown>("two");
    const registry = new ServiceRegistry();
    registry.register({ key: one, start: () => ({}), stop: () => { events.push("stop-one"); } });
    registry.register({ key: two, required: [one], start: () => { throw new Error("boom"); } });
    await expect(registry.start()).rejects.toThrow("boom");
    expect(events).toEqual(["stop-one"]);
  });

  it("owns child scopes and effects with idempotent reverse cleanup", async () => {
    const events: string[] = [];
    const root = new RuntimeScope("host", "root");
    root.defer(() => { events.push("root"); });
    const child = root.child("session", "session-1");
    child.defer(() => { events.push("child"); });
    await root.close();
    await root.close();
    expect(events).toEqual(["child", "root"]);
  });

  it("starts registered optional dependencies before their consumer", async () => {
    const events: string[] = [];
    const optional = serviceKey<{ ready: true }>("optional");
    const consumer = serviceKey<{ hasOptional: boolean }>("consumer");
    const registry = new ServiceRegistry();
    registry.register({ key: consumer, optional: [optional], start: context => { events.push("consumer"); return { hasOptional: context.optional(optional)?.ready ?? false }; } });
    registry.register({ key: optional, start: () => { events.push("optional"); return { ready: true as const }; } });
    await registry.start();
    expect(registry.get(consumer).hasOptional).toBe(true);
    expect(events).toEqual(["optional", "consumer"]);
    await registry.close();
  });

  it("tracks agents and disposes each handle and scope once", async () => {
    const events: string[] = [];
    const root = new RuntimeScope("host", "host");
    const registry = new AgentRegistry(root);
    registry.register({ id: "agent-1", sessionId: "session-1", close: () => { events.push("agent"); } });
    await expect(registry.dispose("agent-1")).resolves.toBe(true);
    await expect(registry.dispose("agent-1")).resolves.toBe(false);
    await registry.close();
    expect(events).toEqual(["agent"]);
    await root.close();
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { memoryCommand } from "../../src/cli/memory-command.js";
import { MemoryStore } from "../../src/memory/store.js";
import { MemoryRuntime } from "../../src/memory/runtime.js";

describe("/memory command", () => {
  let store: MemoryStore | undefined; let runtime: MemoryRuntime | undefined; let directory: string | undefined;
  afterEach(() => { runtime?.close(); if (!runtime) store?.close(); if (directory) rmSync(directory, { recursive: true, force: true }); });
  it("lists and shows memories in non-TTY mode", async () => {
    directory = mkdtempSync(join(tmpdir(), "isla-cli-memory-")); store = new MemoryStore(join(directory, "memory.sqlite"));
    const record = store.create({ scope: "global", kind: "preference", content: "concise", provenance: "explicit-user" });
    const output = new PassThrough(); const chunks: Buffer[] = []; output.on("data", chunk => chunks.push(chunk));
    const context = { input: new PassThrough(), output, providerId: "test", model: "test", systemPrompt: undefined, sessionStore: {} as never, currentSession: {} as never, availableCommands: [], memoryStore: store, commandLine: `/memory show ${record.id}` };
    await memoryCommand.execute(context); expect(Buffer.concat(chunks).toString()).toContain("concise");
  });
  it("edits, disables, restores, and enables memories through revisions", async () => {
    directory = mkdtempSync(join(tmpdir(), "isla-cli-memory-")); store = new MemoryStore(join(directory, "memory.sqlite"));
    const record = store.create({ scope: "global", kind: "preference", content: "one", provenance: "inferred", status: "candidate" });
    const output = new PassThrough(); const chunks: Buffer[] = []; output.on("data", chunk => chunks.push(chunk));
    const base = { input: new PassThrough(), output, providerId: "test", model: "test", systemPrompt: undefined, sessionStore: {} as never, currentSession: {} as never, availableCommands: [], memoryStore: store };
    await memoryCommand.execute({ ...base, commandLine: `/memory enable ${record.id}` });
    await memoryCommand.execute({ ...base, commandLine: `/memory edit ${record.id} two` });
    await memoryCommand.execute({ ...base, commandLine: `/memory disable ${record.id}` });
    await memoryCommand.execute({ ...base, commandLine: `/memory restore ${record.id} 3` });
    expect(store.get(record.id)?.content).toBe("two"); expect(store.get(record.id)?.status).toBe("active");
    expect(Buffer.concat(chunks).toString()).toContain("已恢复");
  });
  it("previews the projected memory boundary", async () => {
    directory = mkdtempSync(join(tmpdir(), "isla-cli-memory-")); runtime = MemoryRuntime.open({ path: join(directory, "memory.sqlite") }); store = runtime.store;
    store!.create({ scope: "global", kind: "preference", content: "preview preference", provenance: "explicit-user" });
    const output = new PassThrough(); const chunks: Buffer[] = []; output.on("data", chunk => chunks.push(chunk));
    const context = { input: new PassThrough(), output, providerId: "test", model: "test", systemPrompt: undefined, sessionStore: {} as never, currentSession: {} as never, availableCommands: [], memoryStore: store, memoryRuntime: runtime, commandLine: "/memory preview preference" };
    await memoryCommand.execute(context); expect(Buffer.concat(chunks).toString()).toContain("preview preference");
  });
});

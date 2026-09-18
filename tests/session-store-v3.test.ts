import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonSessionStore } from "../src/session-store.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

describe("Session v3 journal", () => {
  it("round-trips messages and journal together", async () => {
    const directory = await mkdtemp(join(tmpdir(), "isla-session-v3-")); directories.push(directory);
    const store = new JsonSessionStore(directory);
    const session = await store.create("deepseek", "m1", [{ role: "user", content: "你好" }]);
    const saved = await store.save(session, {
      messages: [...session.messages, { role: "assistant", content: "你好，主人" }],
      journal: { version: 1, turns: [{ id: "turn-1", sequence: 1, startedAt: "2026-09-12T00:00:00.000Z", endedAt: "2026-09-12T00:00:01.000Z", status: "completed", userMessageIndex: 0, assistantMessageIndex: 1, attempts: [], actions: [] }] },
    });
    expect(saved.version).toBe(4);
    await expect(store.loadLatest("deepseek", "m1")).resolves.toMatchObject({ version: 4, messages: [{ role: "user" }, { role: "assistant", content: "你好，主人" }], journal: { turns: [{ status: "completed", assistantMessageIndex: 1 }] } });
  });

  it("rejects a corrupted completed turn journal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "isla-session-v3-")); directories.push(directory);
    const store = new JsonSessionStore(directory);
    const session = await store.create("deepseek", "m1", [{ role: "user", content: "secret" }]);
    const path = join(directory, `${session.id}.json`);
    const raw = JSON.parse(await readFile(path, "utf8"));
    raw.journal = { version: 1, turns: [{ id: "turn-1", sequence: 1, startedAt: "now", endedAt: "now", status: "completed", userMessageIndex: 0, assistantMessageIndex: 1, attempts: [], actions: [] }] };
    await writeFile(path, JSON.stringify(raw), "utf8");
    const warnings: string[] = [];
    const checked = new JsonSessionStore(directory, warning => warnings.push(warning));
    await expect(checked.list("deepseek", "m1")).resolves.toEqual([]);
    expect(warnings[0]).toContain("Completed Turn");
  });
});

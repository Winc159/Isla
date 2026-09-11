import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonSessionStore } from "../src/session-store.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe("JSON session store", () => {
  it("creates, updates, and restores the latest matching session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "isla-session-"));
    directories.push(directory);
    const store = new JsonSessionStore(directory);
    const first = await store.create("deepseek", "m1", []);
    await store.save(first, { messages: [{ role: "user", content: "u1" }] });
    await store.create("deepseek", "m2", []);

    await expect(store.list("deepseek", "m1")).resolves.toMatchObject([
      { id: first.id, messages: [{ role: "user", content: "u1" }] },
    ]);
    await expect(store.loadLatest("deepseek", "m1")).resolves.toMatchObject({
      id: first.id,
      messages: [{ role: "user", content: "u1" }],
    });
    const files = await readdir(directory);
    expect(files).toHaveLength(2);
    expect(JSON.parse(await readFile(join(directory, `${first.id}.json`), "utf8"))).toMatchObject({ version: 2, provider: "deepseek", model: "m1" });
  });

  it("rejects stale concurrent saves without leaving temporary files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "isla-session-"));
    directories.push(directory);
    const store = new JsonSessionStore(directory);
    const session = await store.create("deepseek", "m1", []);

    const results = await Promise.allSettled([
      store.save(session, { messages: [{ role: "user", content: "first" }] }),
      store.save(session, { messages: [{ role: "user", content: "second" }] }),
    ]);

    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect((await readdir(directory)).filter(file => file.endsWith(".tmp") || file.endsWith(".lock"))).toEqual([]);
  });

  it("skips an invalid session file and reports a warning", async () => {
    const directory = await mkdtemp(join(tmpdir(), "isla-session-"));
    directories.push(directory);
    const warnings: string[] = [];
    const store = new JsonSessionStore(directory, warning => warnings.push(warning));
    const valid = await store.create("deepseek", "m1", []);
    await writeFile(join(directory, "broken.json"), "not json", "utf8");

    await expect(store.list("deepseek", "m1")).resolves.toMatchObject([{ id: valid.id }]);
    expect(warnings).toEqual([expect.stringContaining("broken.json")]);
  });

  it("keeps persisted tool messages readable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "isla-session-"));
    directories.push(directory);
    const store = new JsonSessionStore(directory);
    const session = await store.create("deepseek", "m1", []);
    await store.save(session, { messages: [{ role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "read_text_file", arguments: "{}" }] }, { role: "tool", toolCallId: "call-1", content: "ok" }] });
    await expect(store.loadLatest("deepseek", "m1")).resolves.toMatchObject({ messages: [{ role: "assistant" }, { role: "tool", toolCallId: "call-1" }] });
  });

  it("drops legacy event copies when loading a session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "isla-session-"));
    directories.push(directory);
    const store = new JsonSessionStore(directory);
    const session = await store.create("deepseek", "m1", [{ role: "user", content: "你好" }]);
    const path = join(directory, `${session.id}.json`);
    const legacy = { ...session, events: [{ type: "user", input: "你好" }] };
    await writeFile(path, `${JSON.stringify(legacy)}\n`, "utf8");
    await expect(store.loadLatest("deepseek", "m1")).resolves.not.toHaveProperty("events");
  });

  it("reads a version 1 session and upgrades it with a context checkpoint", async () => {
    const directory = await mkdtemp(join(tmpdir(), "isla-session-"));
    directories.push(directory);
    const store = new JsonSessionStore(directory);
    const legacy = {
      version: 1,
      id: "legacy",
      createdAt: "2026-09-11T00:00:00.000Z",
      updatedAt: "2026-09-11T00:00:00.000Z",
      provider: "deepseek",
      model: "m1",
      messages: [{ role: "user", content: "旧消息" }],
    } as const;
    await writeFile(join(directory, "legacy.json"), `${JSON.stringify(legacy)}\n`, "utf8");

    const loaded = await store.loadLatest("deepseek", "m1");
    expect(loaded).toMatchObject({ version: 1, messages: legacy.messages });
    const upgraded = await store.save(loaded!, {
      messages: legacy.messages,
      context: {
        version: 1,
        checkpoint: {
          throughMessageIndex: 0,
          createdAt: "2026-09-11T00:01:00.000Z",
          provider: "deepseek",
          model: "m1",
          content: "## 当前目标\n继续旧会话",
        },
      },
    });
    expect(upgraded.version).toBe(2);
    await expect(store.loadLatest("deepseek", "m1")).resolves.toMatchObject({ version: 2, context: { checkpoint: { content: "## 当前目标\n继续旧会话" } } });
  });

});

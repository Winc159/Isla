import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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
    await store.save(first, [{ role: "user", content: "u1" }]);
    await store.create("deepseek", "m2", []);

    await expect(store.loadLatest("deepseek", "m1")).resolves.toMatchObject({
      id: first.id,
      messages: [{ role: "user", content: "u1" }],
    });
    const files = await readdir(directory);
    expect(files).toHaveLength(2);
    expect(JSON.parse(await readFile(join(directory, `${first.id}.json`), "utf8"))).toMatchObject({ version: 1, provider: "deepseek", model: "m1" });
  });
});

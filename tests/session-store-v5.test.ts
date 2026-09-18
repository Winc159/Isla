import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonSessionStore, parseStoredSession, type StoredSkillCatalogV1 } from "../src/session-store.js";

describe("Session v5 Skill catalog", () => {
  it("persists and restores a bounded catalog", async () => {
    const directory = await mkdtemp(join(tmpdir(), "isla-session-v5-"));
    const catalog: StoredSkillCatalogV1 = { version: 1, entries: [{ name: "release-check", description: "Check release", modelInvocable: true, userInvocable: false }] };
    const store = new JsonSessionStore(directory);
    const created = await store.create("fake", "model", [], "workspace-a", catalog);
    expect(created.version).toBe(5);
    const restored = parseStoredSession(await readFile(join(directory, `${created.id}.json`), "utf8"));
    expect(restored).toMatchObject({ version: 5, workspaceKey: "workspace-a", skillCatalog: catalog });
  });

  it("migrates an old session to v5 only when a catalog is persisted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "isla-session-v5-"));
    const store = new JsonSessionStore(directory);
    const created = await store.create("fake", "model", [], "workspace-a");
    const saved = await store.save(created, { messages: [], skillCatalog: { version: 1, entries: [] } });
    expect(saved.version).toBe(5);
  });
});

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonSessionStore, parseStoredSession, type StoredSkillCatalogV1 } from "../src/sessions/store.js";

describe("Session schema migrations", () => {
  it("persists and restores a bounded catalog", async () => {
    const directory = await mkdtemp(join(tmpdir(), "isla-session-v5-"));
    const catalog: StoredSkillCatalogV1 = { version: 1, entries: [{ name: "release-check", description: "Check release", modelInvocable: true, userInvocable: false }] };
    const store = new JsonSessionStore(directory);
    const created = await store.create("fake", "model", [], "workspace-a", catalog);
    expect(created.version).toBe(5);
    const restored = parseStoredSession(await readFile(join(directory, `${created.id}.json`), "utf8"));
    expect(restored).toMatchObject({ version: 5, workspaceKey: "workspace-a", skillCatalog: catalog });
  });

  it("migrates an old session to v6 only when a catalog is persisted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "isla-session-v5-"));
    const store = new JsonSessionStore(directory);
    const created = await store.create("fake", "model", [], "workspace-a");
    const saved = await store.save(created, { messages: [], skillCatalog: { version: 1, entries: [] } });
    expect(saved.version).toBe(6);
  });

  it('restores plan approval, step evidence, progress and replan count after a store reload', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'isla-session-v074-'));
    const store = new JsonSessionStore(directory);
    const created = await store.create('fake', 'model', [], 'workspace-a');
    const workPlan = { version:1 as const, planId:'plan-a', revision:2, progressRevision:3, replanCount:1, goal:'Finish task', constraints:[], assumptions:[], steps:[{id:'step-1',title:'Verify',kind:'verify' as const,status:'completed' as const,dependencies:[],evidenceCallIds:['call-verify']}], risks:[], verification:['tests pass'], openQuestions:[], status:'completed' as const, approvedRevision:2, updatedAt:new Date().toISOString() };
    const workMode = { version:1 as const, mode:'act' as const, revision:4, actApprovedRevision:2, updatedAt:new Date().toISOString() };
    await store.save(created,{messages:[],workPlan,workMode});
    const restored = await new JsonSessionStore(directory).loadLatest('fake','model','workspace-a');
    expect(restored).toMatchObject({version:6,workPlan,workMode});
  });
});

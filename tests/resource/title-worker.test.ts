import { describe, expect, it } from "vitest";
import { chooseResourceNameWithWorker } from "../../src/resource/title-worker.js";

describe("title worker boundary", () => {
  it("does not call Worker when deterministic naming is available", async () => {
    const client = { run: async () => { throw new Error("must not call"); } } as never;
    await expect(chooseResourceNameWithWorker(client, { titleCandidates: ["中文标题"], completedAt: new Date() })).resolves.toMatchObject({ source: "rules" });
  });
  it("requires confirmation for a Worker title", async () => {
    const client = { run: async () => ({ output: { title: "有意义标题" } }) } as never;
    await expect(chooseResourceNameWithWorker(client, { downloadedNames: ["a1b2c3d4e5f6a7b8.zip"], completedAt: new Date() }, { category: "mixed" })).resolves.toMatchObject({ name: "有意义标题", source: "worker", needsConfirmation: true });
  });
  it("falls back to the extraction date when only an archive filename exists", async () => {
    await expect(chooseResourceNameWithWorker(undefined, { downloadedNames: ["fixture.zip"], completedAt: new Date("2026-10-20T00:00:00Z") })).resolves.toMatchObject({ source: "timestamp", name: "resource-20261020-000000Z" });
  });
});

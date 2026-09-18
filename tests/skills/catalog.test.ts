import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SkillCatalog } from "../../src/skills/catalog.js";

async function skill(root: string, name: string, description: string, body = "body"): Promise<void> {
  await mkdir(join(root, name), { recursive: true });
  await writeFile(join(root, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n${body}`, "utf8");
}

describe("skill catalog", () => {
  it("discovers and deterministically overlays workspace skills", async () => {
    const home = await mkdtemp(join(tmpdir(), "isla-skills-"));
    const personal = join(home, "personal");
    const workspace = join(home, "workspace");
    await mkdir(personal); await mkdir(workspace);
    await skill(personal, "shared", "personal");
    await skill(personal, "user-only", "user");
    await skill(workspace, "shared", "workspace");
    const catalog = new SkillCatalog({ personalRoot: personal, workspaceRoot: workspace });
    await expect(catalog.list()).resolves.toMatchObject({ entries: [{ name: "shared", description: "workspace" }, { name: "user-only" }] });
    await expect(catalog.load("shared")).resolves.toMatchObject({ description: "workspace", content: "body" });
  });

  it("returns an empty catalog for missing roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "isla-skills-"));
    await expect(new SkillCatalog({ personalRoot: join(root, "missing"), workspaceRoot: join(root, "also-missing") }).list()).resolves.toEqual({ entries: [], diagnostics: [] });
  });
});

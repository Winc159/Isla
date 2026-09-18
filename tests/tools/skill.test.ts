import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SkillCatalog } from "../../src/skills/catalog.js";
import { createSkillCapability } from "../../src/tools/skill.js";

describe("skill capability", () => {
  it("exposes a bounded catalog and loads only the exact name", async () => {
    const root = await mkdtemp(join(tmpdir(), "isla-skill-tool-"));
    const workspace = join(root, "workspace");
    await mkdir(join(workspace, "release-check"), { recursive: true });
    await writeFile(join(workspace, "release-check", "SKILL.md"), "---\nname: release-check\ndescription: Check release\n---\nRead the fixture first.", "utf8");
    const capability = createSkillCapability(new SkillCatalog({ workspaceRoot: workspace, personalRoot: join(root, "personal") }));
    expect(capability?.instructions).toContain("release-check: Check release");
    const tool = capability?.tools[0];
    expect(tool?.definition.parameters).toMatchObject({ additionalProperties: false, required: ["name"] });
    await expect(tool?.execute('{"name":"release-check"}')).resolves.toContain("Read the fixture first.");
    await expect(tool?.execute('{"name":"../secret"}')).resolves.toContain("SKILL_NOT_IN_SESSION");
    await expect(tool?.execute('{"name":"release-check","path":"C:/secret"}')).resolves.toContain("SKILL");
  });
});

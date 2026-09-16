import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGlobProjectTool, createGrepProjectTool } from "../../src/tools/project-discovery.js";

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "isla-discovery-"));
  await mkdir(join(root, "src", "nested"), { recursive: true });
  await mkdir(join(root, "node_modules", "hidden-package"), { recursive: true });
  await mkdir(join(root, ".isla-local"), { recursive: true });
  await writeFile(join(root, "src", "main.ts"), "export function alpha() {\n  return 'needle';\n}\n", "utf8");
  await writeFile(join(root, "src", "nested", "other.ts"), "export const beta = 'needle';\n", "utf8");
  await writeFile(join(root, "README.md"), "needle in docs\n", "utf8");
  await writeFile(join(root, ".env"), "SECRET=needle\n", "utf8");
  await writeFile(join(root, "node_modules", "hidden-package", "index.ts"), "needle\n", "utf8");
  await writeFile(join(root, ".isla-local", "private.ts"), "needle\n", "utf8");
  return root;
}

describe("project discovery tools", () => {
  it("finds files by glob with stable workspace-relative paths and exclusions", async () => {
    const root = await createWorkspace();
    const output = await createGlobProjectTool(root).execute(JSON.stringify({ pattern: "*.ts" }));

    expect(output).toBe("src/main.ts\nsrc/nested/other.ts");
  });

  it("searches regex matches with path, include, line number, and bounded exclusions", async () => {
    const root = await createWorkspace();
    const output = await createGrepProjectTool(root).execute(JSON.stringify({ pattern: "needle", path: "src", include: "*.ts" }));

    expect(output).toContain("Found 2 matches");
    expect(output).toContain("src/main.ts\nLine 2:   return 'needle';");
    expect(output).toContain("src/nested/other.ts\nLine 1: export const beta = 'needle';");
    expect(output).not.toContain("node_modules");
  });

  it("rejects paths outside the workspace and invalid include filters", async () => {
    const root = await createWorkspace();
    const grep = createGrepProjectTool(root);

    await expect(grep.execute(JSON.stringify({ pattern: "needle", path: "../outside" }))).rejects.toMatchObject({ code: "SANDBOX_DENIED" });
    await expect(grep.execute(JSON.stringify({ pattern: "needle", include: "!*.ts" }))).rejects.toMatchObject({ code: "INVALID_ARGUMENTS" });
  });

  it("does not traverse an explicit directory symlink", async () => {
    const root = await createWorkspace();
    const external = await mkdtemp(join(tmpdir(), "isla-discovery-external-"));
    await writeFile(join(external, "outside.ts"), "needle\n", "utf8");
    await symlink(external, join(root, "linked"), "junction");

    await expect(createGlobProjectTool(root).execute(JSON.stringify({ pattern: "*.ts", path: "linked" }))).rejects.toMatchObject({ code: "SANDBOX_DENIED" });
  });
});

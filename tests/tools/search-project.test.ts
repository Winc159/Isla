import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createSearchProjectTool } from "../../src/tools/search-project.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import { ToolRuntime } from "../../src/tools/runtime.js";

describe("search_project tool", () => {
  it("searches read-only and does not request approval", async () => {
    const root = await mkdtemp(join(tmpdir(), "isla-search-tool-"));
    await mkdir(join(root, "docs")); await writeFile(join(root, "docs", "note.md"), "可靠检索\n");
    const tool = createSearchProjectTool(root);
    const registry = new ToolRegistry(); registry.register(tool);
    await expect(new ToolRuntime(registry, { approvalPolicy: "ask", permissionPreset: "readonly" }).execute({ id: "1", name: "search_project", arguments: JSON.stringify({ query: "检索" }) })).resolves.toMatchObject({ ok: true, content: expect.stringContaining("docs/note.md:1-2") });
  });

  it("rejects invalid arguments", async () => {
    const tool = createSearchProjectTool(process.cwd());
    await expect(tool.execute("{}" )).rejects.toThrow("query must be a string");
    await expect(tool.execute(JSON.stringify({ query: "x", path: 1 }))).rejects.toThrow("path must be a string");
  });
});

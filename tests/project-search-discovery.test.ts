import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { discoverProjectFiles } from "../src/project-search/discovery.js";
import { ProjectSearchValidationError } from "../src/project-search/types.js";

describe("project file discovery", () => {
  it("returns sorted relative text files and filters generated and secret files", async () => {
    const root = await mkdtemp(join(tmpdir(), "isla-discovery-"));
    await mkdir(join(root, "src")); await mkdir(join(root, "node_modules")); await mkdir(join(root, ".git"));
    await writeFile(join(root, "z.txt"), "z"); await writeFile(join(root, "src", "a.md"), "a");
    await writeFile(join(root, ".env"), "SECRET=hidden"); await writeFile(join(root, "node_modules", "ignored.js"), "ignored");
    await writeFile(join(root, "binary.bin"), Buffer.from([1, 0, 2]));
    expect((await discoverProjectFiles(root)).map(file => file.path)).toEqual(["src/a.md", "z.txt"]);
  });

  it("supports a relative directory scope and rejects absolute paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "isla-discovery-"));
    await mkdir(join(root, "docs")); await writeFile(join(root, "docs", "readme.md"), "readme");
    expect((await discoverProjectFiles(root, "docs")).map(file => file.path)).toEqual(["docs/readme.md"]);
    await expect(discoverProjectFiles(root, join(root, "docs"))).rejects.toBeInstanceOf(ProjectSearchValidationError);
  });
});

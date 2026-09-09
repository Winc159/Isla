import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createListDirectoryTool } from "../../src/tools/list-directory.js";
import { createReadTextFileTool } from "../../src/tools/read-text-file.js";

const root = join(process.cwd(), ".tmp-tool-test");
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("read_text_file", () => {
  it("reads a relative text file inside the project root", async () => {
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "docs", "note.md"), "hello", "utf8");
    await expect(createReadTextFileTool(root).execute(JSON.stringify({ path: "docs/note.md" }))).resolves.toBe("hello");
  });
  it("rejects paths outside the project and secret files", async () => {
    const read = createReadTextFileTool(root);
    await expect(read.execute(JSON.stringify({ path: "../secret.txt" }))).rejects.toThrow("inside");
    await expect(read.execute(JSON.stringify({ path: ".env" }))).rejects.toThrow("secret");
  });
  it("lists direct children without leaving the project root", async () => {
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "docs", "note.md"), "hello", "utf8");
    await expect(createListDirectoryTool(root).execute(JSON.stringify({ path: "docs" }))).resolves.toContain("file\tnote.md");
  });
});

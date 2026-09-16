import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createListDirectoryTool } from "../../src/tools/list-directory.js";
import { createReadTextFileTool } from "../../src/tools/read-text-file.js";
import { createWriteTextFileTool } from "../../src/tools/write-text-file.js";
import { createProjectFilesCapability } from "../../src/tools/project-files.js";
import type { Tool } from "../../src/tools/types.js";
import { buildTextReadResult, READ_STREAM_MIN_SIZE } from "../../src/tools/read-text-window.js";

const root = join(process.cwd(), ".tmp-tool-test");
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("read_text_file", () => {
  it("reads a relative text file inside the project root", async () => {
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "docs", "note.md"), "hello", "utf8");
    await expect(createReadTextFileTool(root).execute(JSON.stringify({ path: "docs/note.md" }))).resolves.toBe("<path>docs/note.md</path>\n<type>file</type>\n<content>\n1: hello\n\n(End of file - total 1 lines)\n</content>");
  });
  it("returns numbered windows with exact totals and continuation hints", async () => {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "lines.txt"), "one\r\ntwo\r\nthree\r\n", "utf8");
    const read = createReadTextFileTool(root);
    const first = await read.execute(JSON.stringify({ path: "lines.txt", limit: 2 }));
    expect(first).toContain("1: one\n2: two");
    expect(first).toContain("Showing lines 1-2 of 3. Use offset=3 to continue.");
    const last = await read.execute(JSON.stringify({ path: "lines.txt", offset: 3, limit: 1 }));
    expect(last).toContain("3: three");
    expect(last).toContain("End of file - total 3 lines");
  });
  it("handles empty files and rejects invalid or out-of-range windows", async () => {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "empty.txt"), "", "utf8");
    await writeFile(join(root, "one.txt"), "one", "utf8");
    const read = createReadTextFileTool(root);
    await expect(read.execute(JSON.stringify({ path: "empty.txt" }))).resolves.toContain("End of file - total 0 lines");
    await expect(read.execute(JSON.stringify({ path: "one.txt", offset: 0 }))).rejects.toMatchObject({ code: "INVALID_ARGUMENTS" });
    await expect(read.execute(JSON.stringify({ path: "one.txt", limit: 2001 }))).rejects.toMatchObject({ code: "INVALID_ARGUMENTS" });
    await expect(read.execute(JSON.stringify({ path: "one.txt", offset: 2 }))).rejects.toMatchObject({ code: "INVALID_ARGUMENTS" });
  });
  it("caps long lines and selected output bytes while scanning all chunks", async () => {
    async function* chunks(): AsyncIterable<string> {
      yield "abcd";
      yield "ef\nsecond\nthird";
    }
    const result = await buildTextReadResult(chunks(), "fixture.txt", { offset: 1, limit: 3, maxLineLength: 4, maxBytes: 40 });
    expect(result.text).toContain("1: abcd... (line truncated to 4 chars)");
    expect(result.text).toContain("Output capped");
    expect(result.totalLines).toBe(3);
  });
  it("streams files at the large-file threshold without returning their full content", async () => {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "large.txt"), "x".repeat(READ_STREAM_MIN_SIZE), "utf8");
    const result = await createReadTextFileTool(root).execute(JSON.stringify({ path: "large.txt" }));
    expect(result).toContain("line truncated to 2000 chars");
    expect(result.length).toBeLessThan(3000);
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
  it("rejects writing protected files and allows files inside the root", async () => {
    const write = createWriteTextFileTool(root);
    await expect(write.execute(JSON.stringify({ path: ".env", content: "SECRET" }))).rejects.toThrow("protected");
    await expect(write.execute(JSON.stringify({ path: "docs/new.md", content: "new" }))).resolves.toContain("docs/new.md");
    await expect(write.execute(JSON.stringify({ path: "docs/new.md", content: "updated" }))).resolves.toContain("docs/new.md");
  });
});

describe("edit_text_file", () => {
  it("requires a prior read and applies one exact replacement", async () => {
    await mkdir(join(root, "src"), { recursive: true });
    const path = join(root, "src", "value.ts");
    await writeFile(path, "const value = 'old';\n", "utf8");
    const tools = projectTools();
    await expect(tools.edit.execute(JSON.stringify({ path: "src/value.ts", oldText: "old", newText: "new" }))).rejects.toMatchObject({ code: "FILE_NOT_OBSERVED" });
    await tools.read.execute(JSON.stringify({ path: "src/value.ts" }));
    await expect(tools.edit.execute(JSON.stringify({ path: "src/value.ts", oldText: "old", newText: "new" }))).resolves.toBe("已编辑 src/value.ts；替换 1 处");
    expect(await readFile(path, "utf8")).toBe("const value = 'new';\n");
    expect((await readdir(join(root, "src"))).filter(name => name.endsWith(".tmp"))).toEqual([]);
  });

  it("uses the complete file revision after a windowed read", async () => {
    await mkdir(root, { recursive: true });
    const path = join(root, "windowed.txt");
    await writeFile(path, "first\nsecond\nthird\n", "utf8");
    const tools = projectTools();
    await tools.read.execute(JSON.stringify({ path: "windowed.txt", offset: 2, limit: 1 }));
    await expect(tools.edit.execute(JSON.stringify({ path: "windowed.txt", oldText: "second", newText: "updated" }))).resolves.toContain("替换 1 处");
    await writeFile(path, "outside\nupdated\nthird\n", "utf8");
    await expect(tools.edit.execute(JSON.stringify({ path: "windowed.txt", oldText: "updated", newText: "again" }))).rejects.toMatchObject({ code: "FILE_STALE" });
  });

  it("rejects stale files until they are read again", async () => {
    await mkdir(root, { recursive: true });
    const path = join(root, "value.txt");
    await writeFile(path, "first", "utf8");
    const tools = projectTools();
    await tools.read.execute(JSON.stringify({ path: "value.txt" }));
    await writeFile(path, "changed outside", "utf8");
    await expect(tools.edit.execute(JSON.stringify({ path: "value.txt", oldText: "first", newText: "second" }))).rejects.toMatchObject({ code: "FILE_STALE" });
    await tools.read.execute(JSON.stringify({ path: "value.txt" }));
    await expect(tools.edit.execute(JSON.stringify({ path: "value.txt", oldText: "changed outside", newText: "second" }))).resolves.toContain("替换 1 处");
  });

  it("rejects zero or ambiguous matches and supports explicit replaceAll", async () => {
    await mkdir(root, { recursive: true });
    const path = join(root, "repeated.txt");
    await writeFile(path, "old old", "utf8");
    const tools = projectTools();
    await tools.read.execute(JSON.stringify({ path: "repeated.txt" }));
    await expect(tools.edit.execute(JSON.stringify({ path: "repeated.txt", oldText: "missing", newText: "new" }))).rejects.toMatchObject({ code: "EDIT_NO_MATCH" });
    await expect(tools.edit.execute(JSON.stringify({ path: "repeated.txt", oldText: "old", newText: "new" }))).rejects.toMatchObject({ code: "EDIT_MULTIPLE_MATCHES" });
    await expect(tools.edit.execute(JSON.stringify({ path: "repeated.txt", oldText: "old", newText: "new", replaceAll: true }))).resolves.toContain("替换 2 处");
    expect(await readFile(path, "utf8")).toBe("new new");
  });

  it("keeps observations current after writes and edits without exposing content in approval summaries", async () => {
    const tools = projectTools();
    await tools.write.execute(JSON.stringify({ path: "created.txt", content: "private old content" }));
    const summary = await tools.edit.describe?.(JSON.stringify({ path: "created.txt", oldText: "private old content", newText: "private new content" }));
    expect(summary).toContain("旧文本 19 个字符");
    expect(summary).not.toContain("private");
    await tools.edit.execute(JSON.stringify({ path: "created.txt", oldText: "private old content", newText: "private new content" }));
    await expect(tools.edit.execute(JSON.stringify({ path: "created.txt", oldText: "private new content", newText: "final" }))).resolves.toContain("替换 1 处");
  });

  it("uses filesystem-write permission and preserves sandbox restrictions", async () => {
    const tools = projectTools();
    expect(tools.edit.permission).toEqual({ kind: "filesystem-write" });
    await expect(tools.edit.execute(JSON.stringify({ path: "../outside.txt", oldText: "a", newText: "b" }))).rejects.toMatchObject({ code: "SANDBOX_DENIED" });
    await expect(tools.edit.execute(JSON.stringify({ path: ".env", oldText: "a", newText: "b" }))).rejects.toMatchObject({ code: "SANDBOX_DENIED" });
  });
});

function projectTools(): { read: Tool; edit: Tool; write: Tool } {
  const tools = createProjectFilesCapability(root).tools;
  return {
    read: tools.find(tool => tool.definition.name === "read_text_file")!,
    edit: tools.find(tool => tool.definition.name === "edit_text_file")!,
    write: tools.find(tool => tool.definition.name === "write_text_file")!,
  };
}

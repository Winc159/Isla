import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { DeterministicProjectSearch } from "../src/project-search/search.js";

describe("DeterministicProjectSearch", () => {
  it("matches English and Chinese text with merged context and stable source IDs", async () => {
    const root = await mkdtemp(join(tmpdir(), "isla-search-"));
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "docs", "guide.md"), "before\n会话 查询需要稳定。\n继续记录。\nafter\n");
    const service = new DeterministicProjectSearch(root);
    const first = await service.search({ text: "会话查询", contextLines: 1 });
    const second = await service.search({ text: "会话查询", contextLines: 1 });
    expect(first.sources).toHaveLength(1);
    expect(first.sources[0]).toMatchObject({ path: "docs/guide.md", startLine: 1, endLine: 3 });
    expect(first.sources[0]?.id).toBe(second.sources[0]?.id);
  });

  it("supports path matching and deterministic limits", async () => {
    const root = await mkdtemp(join(tmpdir(), "isla-search-"));
    await writeFile(join(root, "alpha.md"), "same\n"); await writeFile(join(root, "beta.md"), "same\n");
    const service = new DeterministicProjectSearch(root);
    const result = await service.search({ text: "alpha", contextLines: 0 });
    expect(result.sources[0]?.path).toBe("alpha.md");
    expect((await service.search({ text: "same", limit: 1 })).truncated).toBe(true);
  });
});

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { PROJECT_SEARCH_EVALUATION_CASES } from "./fixtures/project-search-cases.js";
import { DeterministicProjectSearch } from "../src/project-search/search.js";

describe("offline project search evaluation", () => {
  it.each(PROJECT_SEARCH_EVALUATION_CASES)("passes $name", async evaluation => {
    const root = await mkdtemp(join(tmpdir(), "isla-project-eval-"));
    for (const file of evaluation.files) {
      await mkdir(join(root, file.path, ".."), { recursive: true });
      await writeFile(join(root, file.path), file.content, "utf8");
    }
    const result = await new DeterministicProjectSearch(root).search({ text: evaluation.query, contextLines: 0 });
    const paths = result.sources.map(source => source.path);
    for (const expected of evaluation.mustInclude) expect(paths).toContain(expected);
    for (const forbidden of evaluation.mustExclude) expect(paths).not.toContain(forbidden);
  });

  it("reports bounded truncation and keeps ignored data out of results", async () => {
    const root = await mkdtemp(join(tmpdir(), "isla-project-eval-"));
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "a.md"), "target\n"); await writeFile(join(root, "b.md"), "target\n");
    await writeFile(join(root, "node_modules", "secret.md"), "target\n"); await writeFile(join(root, ".env"), "target\n");
    const result = await new DeterministicProjectSearch(root).search({ text: "target", limit: 1, contextLines: 0 });
    expect(result.sources).toHaveLength(1);
    expect(result.truncated).toBe(true);
    expect(result.sources[0]?.path).toBe("a.md");
  });
});

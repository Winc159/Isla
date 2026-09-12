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
    const result = await new DeterministicProjectSearch(root).search({ text: evaluation.query, ...(evaluation.path ? { path: evaluation.path } : {}), contextLines: 0 });
    const paths = result.sources.map(source => source.path);
    for (const expected of evaluation.mustInclude) expect(paths).toContain(expected);
    for (const forbidden of evaluation.mustExclude) expect(paths).not.toContain(forbidden);
    if (evaluation.expectedTop1) expect(paths[0]).toBe(evaluation.expectedTop1);
    for (const expected of evaluation.expectedTop3 ?? []) expect(paths.slice(0, 3)).toContain(expected);
  });

  it("computes a deterministic quality baseline without enforcing future ranking", async () => {
    const observations: Array<{ readonly name: string; readonly top1: string | undefined; readonly top3: readonly string[]; readonly forbidden: number; readonly filesScanned: number; readonly truncated: boolean }> = [];
    for (const evaluation of PROJECT_SEARCH_EVALUATION_CASES) {
      const root = await mkdtemp(join(tmpdir(), "isla-project-eval-baseline-"));
      for (const file of evaluation.files) {
        await mkdir(join(root, file.path, ".."), { recursive: true });
        await writeFile(join(root, file.path), file.content, "utf8");
      }
      const result = await new DeterministicProjectSearch(root).search({ text: evaluation.query, ...(evaluation.path ? { path: evaluation.path } : {}), contextLines: 0 });
      const paths = result.sources.map(source => source.path);
      observations.push({ name: evaluation.name, top1: paths[0], top3: paths.slice(0, 3), forbidden: evaluation.mustExclude.filter(path => paths.includes(path)).length, filesScanned: result.filesScanned, truncated: result.truncated });
    }
    expect(observations).toHaveLength(PROJECT_SEARCH_EVALUATION_CASES.length);
    expect(observations.every(observation => observation.filesScanned >= 1)).toBe(true);
    expect(observations.every(observation => observation.forbidden === 0)).toBe(true);
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

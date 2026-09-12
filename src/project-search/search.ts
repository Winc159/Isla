import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { discoverProjectFiles } from "./discovery.js";
import { PROJECT_SEARCH_DEFAULTS, type ProjectSearchQuery, type ProjectSearchResult, type ProjectSearchService, type ProjectSource, validateProjectSearchQuery } from "./types.js";

export class DeterministicProjectSearch implements ProjectSearchService {
  constructor(private readonly projectRoot: string) {}

  async search(query: ProjectSearchQuery): Promise<ProjectSearchResult> {
    const valid = validateProjectSearchQuery(query);
    const limit = valid.limit ?? PROJECT_SEARCH_DEFAULTS.limit;
    const maxChars = valid.maxChars ?? PROJECT_SEARCH_DEFAULTS.maxChars;
    const contextLines = valid.contextLines ?? PROJECT_SEARCH_DEFAULTS.contextLines;
    const files = await discoverProjectFiles(this.projectRoot, valid.path ?? "");
    const sources: ProjectSource[] = [];
    let usedChars = 0;
    let truncated = false;
    for (const file of files) {
      const content = await readFile(file.absolutePath, "utf8").catch(() => undefined);
      if (content === undefined) continue;
      const lines = content.split(/\r?\n/);
      const normalizedQuery = normalize(valid.text);
      const terms = searchTerms(normalizedQuery);
      const pathMatch = terms.some(term => normalize(file.path).includes(term));
      const matchingLines = lines.flatMap((line, index) => terms.some(term => normalize(line).includes(term)) ? [index] : []);
      if (!pathMatch && !matchingLines.length) continue;
      const groups = mergeAdjacent(matchingLines);
      for (const group of groups) {
        if (sources.length >= limit) { truncated = true; break; }
        const start = Math.max(0, (group[0] ?? 0) - contextLines);
        const end = Math.min(lines.length - 1, (group.at(-1) ?? 0) + contextLines);
        const excerpt = lines.slice(start, end + 1).join("\n").trim();
        if (usedChars + excerpt.length > maxChars) { truncated = true; break; }
        sources.push({ id: sourceId(file.path, start + 1, end + 1, excerpt), path: file.path, startLine: start + 1, endLine: end + 1, excerpt });
        usedChars += excerpt.length;
      }
      if (pathMatch && !matchingLines.length && sources.length < limit) {
        const excerpt = lines.slice(0, Math.min(lines.length, contextLines * 2 + 1)).join("\n").trim();
        if (usedChars + excerpt.length <= maxChars) sources.push({ id: sourceId(file.path, 1, Math.min(lines.length, contextLines * 2 + 1), excerpt), path: file.path, startLine: 1, endLine: Math.min(lines.length, contextLines * 2 + 1), excerpt });
        else truncated = true;
      }
      if (truncated) break;
    }
    return { sources, filesScanned: files.length, truncated };
  }
}

function normalize(value: string): string { return value.normalize("NFKC").toLocaleLowerCase(); }
function searchTerms(value: string): string[] {
  const terms = new Set([value, ...value.split(/\s+/).filter(term => term.length > 1)]);
  const cjk = value.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g) ?? [];
  for (const segment of cjk) for (let index = 0; index < segment.length - 1; index += 1) terms.add(segment.slice(index, index + 2));
  return [...terms].filter(Boolean);
}
function mergeAdjacent(indices: readonly number[]): number[][] {
  const groups: number[][] = [];
  for (const index of indices) { const last = groups.at(-1); if (last && index <= (last.at(-1) ?? -2) + 1) last.push(index); else groups.push([index]); }
  return groups;
}
function sourceId(path: string, startLine: number, endLine: number, excerpt: string): string {
  const hash = createHash("sha256").update("project-source-v1\0").update(path).update("\0").update(String(startLine)).update("\0").update(String(endLine)).update("\0").update(excerpt).digest("hex");
  return `project:v1:${hash}`;
}

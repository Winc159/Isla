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
    const maxSourceChars = PROJECT_SEARCH_DEFAULTS.maxSourceChars;
    const contextLines = valid.contextLines ?? PROJECT_SEARCH_DEFAULTS.contextLines;
    const files = await discoverProjectFiles(this.projectRoot, valid.path ?? "");
    const normalizedQuery = normalize(valid.text).trim();
    const primaryTerms = searchTerms(normalizedQuery);
    const fallbackBigrams = cjkBigrams(normalizedQuery);
    const candidates: Array<{ source: ProjectSource; score: number }> = [];
    for (const file of files) {
      const content = await readFile(file.absolutePath, "utf8").catch(() => undefined);
      if (content === undefined) continue;
      const lines = content.split(/\r?\n/);
      const pathText = normalize(file.path);
      const fileName = pathText.split("/").at(-1) ?? pathText;
      const pathMatch = primaryTerms.some(term => pathText.includes(term)) || fallbackBigrams.some(term => pathText.includes(term));
      const matchingLines = lines.flatMap((line, index) => primaryTerms.some(term => normalize(line).includes(term)) || fallbackBigrams.some(term => normalize(line).includes(term)) ? [index] : []);
      if (!pathMatch && !matchingLines.length) continue;
      const groups = mergeAdjacent(matchingLines);
      for (const group of groups) {
        const start = Math.max(0, (group[0] ?? 0) - contextLines);
        const end = Math.min(lines.length - 1, (group.at(-1) ?? 0) + contextLines);
        const excerpt = lines.slice(start, end + 1).join("\n").trim();
        const groupStart = group[0] ?? 0;
        candidates.push({ source: { id: sourceId(file.path, start + 1, end + 1, excerpt), path: file.path, startLine: start + 1, endLine: end + 1, excerpt }, score: scoreCandidate(normalizedQuery, primaryTerms, fallbackBigrams, pathText, fileName, lines.slice(groupStart, (group.at(-1) ?? groupStart) + 1)) });
      }
      if (pathMatch && !matchingLines.length) {
        const excerpt = lines.slice(0, Math.min(lines.length, contextLines * 2 + 1)).join("\n").trim();
        candidates.push({ source: { id: sourceId(file.path, 1, Math.min(lines.length, contextLines * 2 + 1), excerpt), path: file.path, startLine: 1, endLine: Math.min(lines.length, contextLines * 2 + 1), excerpt }, score: scoreCandidate(normalizedQuery, primaryTerms, fallbackBigrams, pathText, fileName, []) });
      }
    }
    candidates.sort((left, right) => right.score - left.score || left.source.path.localeCompare(right.source.path) || left.source.startLine - right.source.startLine || left.source.endLine - right.source.endLine);
    const sources: ProjectSource[] = [];
    let usedChars = 0;
    let truncated = false;
    for (const candidate of candidates) {
      if (sources.length >= limit) { truncated = true; break; }
      if (candidate.source.excerpt.length > maxSourceChars || usedChars + candidate.source.excerpt.length > maxChars) { truncated = true; continue; }
      sources.push(candidate.source);
      usedChars += candidate.source.excerpt.length;
    }
    return { sources, filesScanned: files.length, truncated };
  }
}

function normalize(value: string): string { return value.normalize("NFKC").toLocaleLowerCase(); }
function searchTerms(value: string): string[] {
  const terms = new Set(value.split(/\s+/).filter(Boolean));
  const cjk = value.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g) ?? [];
  for (const segment of cjk) terms.add(segment);
  return [...terms].filter(Boolean);
}
function cjkBigrams(value: string): string[] {
  const bigrams = new Set<string>();
  const cjk = value.match(/[\u3400-\u4dbf\u4e00-\u9fff]+/g) ?? [];
  for (const segment of cjk) if (segment.length > 2) for (let index = 0; index < segment.length - 1; index += 1) bigrams.add(segment.slice(index, index + 2));
  return [...bigrams];
}
function scoreCandidate(query: string, terms: readonly string[], bigrams: readonly string[], path: string, fileName: string, hitLines: readonly string[]): number {
  const hitText = normalize(hitLines.join("\n"));
  const matched = terms.filter(term => hitText.includes(term)).length;
  const fallback = bigrams.filter(term => hitText.includes(term)).length;
  const coverage = terms.length ? Math.floor((matched * 100) / terms.length) : 0;
  return (path === query ? 10000 : 0) + (fileName === query ? 9000 : 0) + (path.includes(query) ? 7000 : 0) + (fileName.includes(query) ? 6500 : 0) + (hitText.includes(query) ? 6000 : 0) + coverage * 100 + matched * 10 + fallback;
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

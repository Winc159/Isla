import type { ProjectSourceReference } from "./types.js";

const SOURCE_MARKER = /\[\[source:(project:v1:[0-9a-f]{64})\]\]/g;

export interface CitationResult {
  readonly text: string;
  readonly citedSourceIds: readonly string[];
  readonly projectSources: readonly ProjectSourceReference[];
}

export function validateAndCleanCitations(text: string, sources: ReadonlyMap<string, ProjectSourceReference>): CitationResult {
  const cited: string[] = [];
  const seen = new Set<string>();
  const cleaned = text.replace(SOURCE_MARKER, (_marker, sourceId: string) => {
    if (sources.has(sourceId) && !seen.has(sourceId)) { seen.add(sourceId); cited.push(sourceId); }
    return "";
  });
  return { text: cleaned, citedSourceIds: cited, projectSources: cited.flatMap(sourceId => { const source = sources.get(sourceId); return source ? [source] : []; }) };
}

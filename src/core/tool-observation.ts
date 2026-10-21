import type { ProjectSourceReference } from './types.js';
import type { ToolExecutionResult } from '../tools/types.js';

export interface ToolObservation {
  readonly evidence: readonly string[];
  readonly sourceUrls: readonly string[];
  readonly projectSources: readonly { id: string; reference: ProjectSourceReference }[];
}

/** Converts tool output into loop-level observations without exposing raw payloads. */
export function observeToolResult(tool: string, execution: ToolExecutionResult): ToolObservation {
  if (!execution.ok) return { evidence: [], sourceUrls: [], projectSources: [] };
  const evidence: string[] = [];
  const sourceUrls: string[] = [];
  const projectSources: { id: string; reference: ProjectSourceReference }[] = [];
  if (tool === 'list_directory' || tool === 'read_text_file') evidence.push(tool);
  if (execution.details?.type === 'web_search') {
    sourceUrls.push(...execution.details.sources.map(source => source.url));
    evidence.push(`web_search:${sourceUrls.join(',') || 'no-sources'}`);
  }
  if (execution.details?.type === 'web_fetch') {
    if (execution.details.statusCode >= 200 && execution.details.statusCode < 300) evidence.push('web_fetch:source-read');
    evidence.push(`web_fetch:${execution.details.finalUrl}#status=${execution.details.statusCode}${execution.details.truncated ? '#truncated' : ''}`);
  }
  if (tool === 'browser_read' || tool === 'browser_links') evidence.push(`${tool}:source-read`);
  if (execution.details?.type === 'project_search') {
    for (const source of execution.details.sources) projectSources.push({ id: source.id, reference: { path: source.path, startLine: source.startLine } });
  }
  return { evidence, sourceUrls, projectSources };
}

import { createHash } from 'node:crypto';
import type { ToolCall } from './types.js';
import type { ToolExecutionResult } from '../tools/types.js';

export type EvidenceCardKind = 'file' | 'directory' | 'project-search' | 'web-search' | 'web-fetch' | 'command' | 'task' | 'observation';
export interface EvidenceCard {
  readonly id: string;
  readonly kind: EvidenceCardKind;
  readonly source: string;
  readonly locator?: string;
  readonly claim: string;
  readonly status: 'confirmed' | 'failed';
  readonly confidence: 'high' | 'medium';
}

function cardId(card: Omit<EvidenceCard, 'id'>): string {
  return createHash('sha256').update(JSON.stringify(card)).digest('hex').slice(0, 16);
}

function argsOf(call: ToolCall): Record<string, unknown> {
  try { return JSON.parse(call.arguments) as Record<string, unknown>; } catch { return {}; }
}

export function buildEvidenceCards(call: ToolCall, result: ToolExecutionResult): readonly EvidenceCard[] {
  const args = argsOf(call);
  if (!result.ok) {
    const card: Omit<EvidenceCard, 'id'> = { kind: 'observation', source: call.name, claim: result.message, status: 'failed', confidence: 'high' };
    return [{ ...card, id: cardId(card) }];
  }
  const cards: Omit<EvidenceCard, 'id'>[] = [];
  const path = typeof args.path === 'string' ? args.path : undefined;
  if (call.name === 'read_text_file') cards.push({ kind: 'file', source: call.name, ...(path ? { locator: path } : {}), claim: 'file content was read successfully', status: 'confirmed', confidence: 'high' });
  else if (call.name === 'list_directory' || call.name === 'glob_project' || call.name === 'grep_project') cards.push({ kind: 'directory', source: call.name, ...(path ? { locator: path } : {}), claim: 'project structure observation completed', status: 'confirmed', confidence: 'high' });
  if (result.details?.type === 'project_search') for (const source of result.details.sources) cards.push({ kind: 'project-search', source: call.name, locator: `${source.path}:${source.startLine}-${source.endLine}`, claim: 'project source matched the search query', status: 'confirmed', confidence: 'high' });
  if (result.details?.type === 'web_search') for (const source of result.details.sources) cards.push({ kind: 'web-search', source: result.details.provider, locator: source.url, claim: 'public source returned by configured web search', status: 'confirmed', confidence: 'medium' });
  if (result.details?.type === 'web_fetch') cards.push({ kind: 'web-fetch', source: call.name, locator: result.details.finalUrl, claim: `HTTP ${result.details.statusCode} content was fetched`, status: result.details.statusCode >= 200 && result.details.statusCode < 300 ? 'confirmed' : 'failed', confidence: 'high' });
  if (result.details?.type === 'command_execution') cards.push({ kind: 'command', source: call.name, locator: result.details.workdir, claim: `command completed with exit code ${result.details.exitCode ?? 'null'}`, status: result.details.exitCode === 0 && !result.details.timedOut && !result.details.aborted ? 'confirmed' : 'failed', confidence: 'high' });
  if (result.details?.type === 'task_state_update') cards.push({ kind: 'task', source: call.name, claim: `task state updated to ${result.details.state.status}`, status: 'confirmed', confidence: 'high' });
  if (!cards.length) cards.push({ kind: 'observation', source: call.name, claim: 'tool completed successfully', status: 'confirmed', confidence: 'medium' });
  return cards.map(card => ({ ...card, id: cardId(card) }));
}

export function renderEvidenceCards(cards: readonly EvidenceCard[]): string {
  return cards.length ? `[[evidence_cards]]\n${cards.map(card => JSON.stringify(card)).join('\n')}\n[[/evidence_cards]]` : '';
}

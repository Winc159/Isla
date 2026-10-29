import type { Message } from './types.js';

export interface LocalCitationMismatch {
  readonly path: string;
  readonly line?: number;
  readonly reason: 'source_not_observed' | 'line_not_observed' | 'quote_mismatch';
  readonly actual?: string;
  readonly quoted?: string;
}

/**
 * Check local file references in a candidate answer against successful file
 * reads retained in this Session. Direct inline quotes on the cited line must
 * match the observed source; paraphrases remain a model-quality responsibility.
 */
export function checkLocalFileCitations(text: string, messages: readonly Message[]): readonly LocalCitationMismatch[] {
  const sources = new Map<string, readonly string[]>();
  for (const message of messages) {
    if (message.role !== 'tool') continue;
    const path = message.content.match(/<path>([^<]+)<\/path>/u)?.[1];
    const body = message.content.match(/<content>\r?\n([\s\S]*?)\r?\n<\/content>/u)?.[1];
    if (!path || body === undefined) continue;
    const lines: string[] = [];
    for (const item of body.split(/\r?\n/u)) {
      const match = item.match(/^\s*(\d+): ?(.*)$/u);
      if (match) lines[Number(match[1])] = match[2]!;
    }
    sources.set(path, lines);
  }

  const mismatches: LocalCitationMismatch[] = [];
  // Match longer extensions first: otherwise the `js` alternative can accept
  // the prefix of `.json`, misclassifying a valid JSON citation as `.js`.
  const citationPattern = /((?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:tsx|mjs|json|yaml|yml|md|txt|ts|js))(?:(?::\s*(\d+))|(?:\s+第\s*(\d+)\s*行))?/gu;
  for (const answerLine of text.split(/\r?\n/u)) {
    const citations = [...answerLine.matchAll(citationPattern)];
    const inlineQuotes = [...answerLine.matchAll(/`([^`]+)`/gu)]
      .map(match => match[1]!.trim())
      .filter(value => !/\.(?:md|txt|ts|tsx|js|mjs|json|ya?ml)(?::\d+)?$/iu.test(value));
    for (const citation of citations) {
      if (/https?:\/\/$/iu.test(answerLine.slice(0, citation.index))) continue;
      const path = citation[1]!;
      const lineText = citation[2] ?? citation[3];
      const sourceLines = sources.get(path);
      if (!sourceLines) {
        mismatches.push({ path, ...(lineText ? { line: Number(lineText) } : {}), reason: 'source_not_observed' });
        continue;
      }
      if (!lineText) continue;
      const line = Number(lineText);
      const actual = sourceLines[line];
      if (actual === undefined) {
        mismatches.push({ path, line, reason: 'line_not_observed' });
        continue;
      }
      const normalize = (value: string) => value.replace(/[*_~`]/gu, '').replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
      const normalizedActual = normalize(actual);
      for (const quoted of inlineQuotes) {
        const normalizedQuote = normalize(quoted);
        if (!normalizedQuote || normalizedQuote === path.toLocaleLowerCase()) continue;
        if (!normalizedActual.includes(normalizedQuote)) {
          mismatches.push({ path, line, reason: 'quote_mismatch', actual, quoted });
          break;
        }
      }
    }
  }
  return mismatches;
}

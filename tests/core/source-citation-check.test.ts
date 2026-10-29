import { describe, expect, it } from 'vitest';
import { checkLocalFileCitations } from '../../src/core/source-citation-check.js';
import type { Message } from '../../src/core/types.js';

function read(path: string, content: string): Message {
  return { role: 'tool', toolCallId: 'read-1', content: `<path>${path}</path>\n<type>file</type>\n<content>\n${content}\n</content>` };
}

describe('checkLocalFileCitations', () => {
  const sources = [read('docs/current-policy.md', '1: # Policy\n2: Effective date: 2026-04-01\n3: The maximum upload size is **25 MB per file**.')];

  it('accepts an observed path, line, and matching direct quote', () => {
    expect(checkLocalFileCitations('Current limit: 25 MB [source: docs/current-policy.md:3] — `The maximum upload size is **25 MB per file**.`', sources)).toEqual([]);
  });

  it('rejects a fabricated direct quote even when the path and line were read', () => {
    expect(checkLocalFileCitations('Current limit: 100 MB [source: docs/current-policy.md:3] — `The maximum upload size is **100 MB per file**.`', sources)).toMatchObject([{ path: 'docs/current-policy.md', line: 3, reason: 'quote_mismatch' }]);
  });

  it('rejects citations to unobserved files and lines', () => {
    expect(checkLocalFileCitations('See docs/other.md:2.', sources)).toMatchObject([{ path: 'docs/other.md', line: 2, reason: 'source_not_observed' }]);
    expect(checkLocalFileCitations('See docs/current-policy.md:20.', sources)).toMatchObject([{ path: 'docs/current-policy.md', line: 20, reason: 'line_not_observed' }]);
  });

  it('ignores URLs and unnumbered local path mentions', () => {
    expect(checkLocalFileCitations('Read https://example.com/docs/policy.md and update docs/current-policy.md.', sources)).toEqual([]);
  });

  it('matches longer source extensions without truncating JSON paths', () => {
    const jsonSource = read('docs/status.json', '1: {\n2:   "status": "ready"\n3: }');
    expect(checkLocalFileCitations('Status is ready [source: docs/status.json:2].', [jsonSource])).toEqual([]);
  });
});

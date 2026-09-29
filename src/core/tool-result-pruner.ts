export interface PrunedToolResult {
  readonly content: string;
  readonly pruned: boolean;
  readonly originalChars: number;
  readonly retainedChars: number;
}

/** Keep a bounded head/tail and a stable marker for later history lookup. */
export function pruneToolResult(content: string, maxChars = 6_000): PrunedToolResult {
  if (content.length <= maxChars) return { content, pruned: false, originalChars: content.length, retainedChars: content.length };
  const head = Math.floor(maxChars * 0.65);
  const tail = maxChars - head;
  const value = `${content.slice(0, head)}\n\n[TOOL_RESULT_PRUNED originalChars=${content.length} retainedChars=${maxChars}]\n\n${content.slice(-tail)}`;
  return { content: value, pruned: true, originalChars: content.length, retainedChars: value.length };
}

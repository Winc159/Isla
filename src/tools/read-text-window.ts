import { createHash } from "node:crypto";
import { invalidArguments } from "./errors.js";

export const READ_MAX_LINES = 2000;
export const READ_MAX_LINE_LENGTH = 2000;
export const READ_MAX_BYTES = 50 * 1024;
export const READ_STREAM_MIN_SIZE = 10 * 1024 * 1024;

export interface TextReadWindow {
  readonly offset: number;
  readonly limit: number;
  readonly maxLineLength?: number;
  readonly maxBytes?: number;
}

export interface TextReadResult {
  readonly text: string;
  readonly revision: string;
  readonly totalLines: number;
  readonly returnedLines: number;
}

export async function buildTextReadResult(chunks: AsyncIterable<string> | Iterable<string>, path: string, window: TextReadWindow, signal?: AbortSignal): Promise<TextReadResult> {
  const maxLineLength = window.maxLineLength ?? READ_MAX_LINE_LENGTH;
  const maxBytes = window.maxBytes ?? READ_MAX_BYTES;
  const hash = createHash("sha256");
  const lines: Array<{ readonly number: number; readonly text: string }> = [];
  let totalLines = 0;
  let outputBytes = 0;
  let truncatedByBytes = false;
  let lineBuffer = "";
  const lineBufferCap = maxLineLength + 1;

  const append = (segment: string): void => {
    if (lineBuffer.length >= lineBufferCap) return;
    lineBuffer += segment;
    if (lineBuffer.length > lineBufferCap) lineBuffer = lineBuffer.slice(0, lineBufferCap);
  };
  const consume = (): void => {
    totalLines += 1;
    if (!truncatedByBytes && totalLines >= window.offset && lines.length < window.limit) {
      const raw = lineBuffer.endsWith("\r") ? lineBuffer.slice(0, -1) : lineBuffer;
      const text = raw.length > maxLineLength ? `${raw.slice(0, maxLineLength)}... (line truncated to ${maxLineLength} chars)` : raw;
      const bytes = Buffer.byteLength(text, "utf8") + (lines.length > 0 ? 1 : 0);
      if (outputBytes + bytes > maxBytes) truncatedByBytes = true;
      else {
        outputBytes += bytes;
        lines.push({ number: totalLines, text });
      }
    }
    lineBuffer = "";
  };

  for await (const chunk of chunks) {
    if (signal?.aborted) throw new Error("当前回合已取消。");
    hash.update(chunk, "utf8");
    let start = 0;
    let newline: number;
    while ((newline = chunk.indexOf("\n", start)) !== -1) {
      append(chunk.slice(start, newline));
      consume();
      start = newline + 1;
    }
    append(chunk.slice(start));
  }
  if (lineBuffer.length > 0) consume();
  if (!truncatedByBytes && window.offset > totalLines && !(totalLines === 0 && window.offset === 1)) {
    throw invalidArguments(`read_text_file offset ${window.offset} is out of range for ${path} (${totalLines} lines)`);
  }

  const endLine = lines.at(-1)?.number ?? Math.max(0, window.offset - 1);
  const footer = truncatedByBytes
    ? `(Output capped. Showing lines ${window.offset}-${endLine}. Use offset=${endLine + 1} to continue.)`
    : endLine < totalLines
      ? `(Showing lines ${window.offset}-${endLine} of ${totalLines}. Use offset=${endLine + 1} to continue.)`
      : `(End of file - total ${totalLines} lines)`;
  const body = lines.length > 0 ? `${lines.map(line => `${line.number}: ${line.text}`).join("\n")}\n\n${footer}` : footer;
  return {
    text: `<path>${path}</path>\n<type>file</type>\n<content>\n${body}\n</content>`,
    revision: hash.digest("hex"),
    totalLines,
    returnedLines: lines.length,
  };
}

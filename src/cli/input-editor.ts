import { emitKeypressEvents, type Key } from 'node:readline';
import type { Writable } from 'node:stream';
import type { InteractiveInput } from './command.js';

export type InputEditorResult =
  | { readonly type: 'submit'; readonly value: string }
  | { readonly type: 'exit' };

export interface CommandSuggestion {
  readonly name: string;
  readonly description: string;
}

const prompt = 'you> ';
const defaultColumns = 80;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function readInteractiveMessage(
  input: InteractiveInput,
  output: Writable,
  history: readonly string[],
  initialValue = '',
  commands: readonly CommandSuggestion[] = [],
): Promise<InputEditorResult> {
  let buffer = splitGraphemes(initialValue);
  let cursor = buffer.length;
  let renderedCursorRow = 0;
  let renderedColumns = getOutputColumns(output);
  let historyIndex = history.length;
  let historyDraft = initialValue;
  let preferredColumn: number | undefined;
  let pasteMode = false;
  let pendingEnter: ReturnType<typeof setImmediate> | undefined;

  emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  output.write('\x1b[?2004h');

  const render = () => {
    const columns = getOutputColumns(output);
    const currentCursorRow = columns === renderedColumns
      ? renderedCursorRow
      : getVisualPosition(buffer, cursor, columns).row;
    clearRenderedInput(output, currentCursorRow);
    const text = buffer.join('');
    output.write(`${prompt}${text}`);

    const cursorPosition = getVisualPosition(buffer, cursor, columns);
    const endPosition = getVisualPosition(buffer, buffer.length, columns);
    const suggestions = getCommandSuggestions(buffer, cursor, commands);
    if (suggestions.length > 0) {
      output.write(`\n${suggestions.map(suggestion => `${suggestion.name}  ${suggestion.description}`).join('\n')}`);
    }
    const suggestionRows = suggestions.reduce(
      (rows, suggestion) => rows + getRenderedLineCount(`${suggestion.name}  ${suggestion.description}`, columns),
      0,
    );
    const renderedEndRow = endPosition.row + suggestionRows;
    if (renderedEndRow > cursorPosition.row) {
      output.write(`\x1b[${renderedEndRow - cursorPosition.row}A`);
    }
    output.write(`\r${cursorPosition.column > 0 ? `\x1b[${cursorPosition.column}C` : ''}`);
    renderedCursorRow = cursorPosition.row;
    renderedColumns = columns;
  };

  render();
  return new Promise(resolve => {
    const finish = (result: InputEditorResult, submittedValue?: string) => {
      if (pendingEnter) clearImmediate(pendingEnter);
      input.removeListener('keypress', onKeypress);
      input.removeListener('end', onEnd);
      input.setRawMode(false);
      input.pause();
      output.write('\x1b[?2004l');
      clearRenderedInput(output, renderedCursorRow);
      if (submittedValue !== undefined) output.write(`${prompt}${submittedValue}\n`);
      else if (result.type === 'exit') output.write('\n');
      resolve(result);
    };

    const submit = () => {
      const value = buffer.join('');
      if (!value.trim()) {
        buffer = [];
        cursor = 0;
        render();
        return;
      }
      finish({ type: 'submit', value }, value);
    };

    const insert = (text: string) => {
      const added = splitGraphemes(text);
      buffer.splice(cursor, 0, ...added);
      cursor += added.length;
      preferredColumn = undefined;
    };

    const onEnd = () => finish({ type: 'exit' });
    const onKeypress = (text: string | undefined, key: Key) => {
      if (pendingEnter) {
        clearImmediate(pendingEnter);
        pendingEnter = undefined;
        insert('\n');
      }

      if (key.name === 'paste-start') {
        pasteMode = true;
        return;
      }
      if (key.name === 'paste-end') {
        pasteMode = false;
        render();
        return;
      }
      if (pasteMode) {
        insert(key.sequence ?? text ?? '');
        return;
      }
      if (isNewlineShortcut(key)) {
        insert('\n');
        render();
        return;
      }
      if (key.ctrl && key.name === 'c') {
        finish({ type: 'exit' });
        return;
      }
      if (key.name === 'escape') {
        finish({ type: 'exit' });
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        pendingEnter = setImmediate(() => {
          pendingEnter = undefined;
          submit();
        });
        return;
      }
      if (key.name === 'tab') {
        const token = findSlashToken(buffer, cursor);
        const suggestions = getCommandSuggestions(buffer, cursor, commands);
        if (suggestions.length === 1) {
          const completion = splitGraphemes(suggestions[0]?.name ?? '');
          buffer.splice(token?.start ?? cursor, (token?.end ?? cursor) - (token?.start ?? cursor), ...completion);
          cursor = (token?.start ?? cursor) + completion.length;
          preferredColumn = undefined;
          render();
        }
        return;
      }
      if (key.name === 'left') {
        cursor = Math.max(0, cursor - 1);
        preferredColumn = undefined;
      } else if (key.name === 'right') {
        cursor = Math.min(buffer.length, cursor + 1);
        preferredColumn = undefined;
      } else if (key.name === 'home') {
        cursor = findLineStart(buffer, cursor);
        preferredColumn = undefined;
      } else if (key.name === 'end') {
        cursor = findLineEnd(buffer, cursor);
        preferredColumn = undefined;
      } else if (key.name === 'backspace') {
        if (cursor > 0) buffer.splice(--cursor, 1);
        preferredColumn = undefined;
      } else if (key.name === 'delete') {
        if (cursor < buffer.length) buffer.splice(cursor, 1);
        preferredColumn = undefined;
      } else if (key.name === 'up' || key.name === 'down') {
        if (buffer.includes('\n')) {
          const targetColumn = preferredColumn ?? getLineColumn(buffer, cursor);
          cursor = moveVertically(buffer, cursor, key.name === 'up' ? -1 : 1, targetColumn);
          preferredColumn = targetColumn;
        } else {
          const direction = key.name === 'up' ? -1 : 1;
          if (direction < 0 && historyIndex === history.length) historyDraft = buffer.join('');
          historyIndex = Math.max(0, Math.min(history.length, historyIndex + direction));
          buffer = splitGraphemes(historyIndex === history.length ? historyDraft : history[historyIndex] ?? '');
          cursor = buffer.length;
        }
      } else if (text && !key.ctrl && !key.meta) {
        insert(text);
      } else {
        return;
      }
      render();
    };

    input.on('keypress', onKeypress);
    input.once('end', onEnd);
  });
}

function getCommandSuggestions(
  buffer: readonly string[],
  cursor: number,
  commands: readonly CommandSuggestion[],
): CommandSuggestion[] {
  const token = findSlashToken(buffer, cursor);
  if (!token || commands.some(command => command.name === token.prefix)) return [];
  return commands.filter(command => command.name.startsWith(token.prefix));
}

function findSlashToken(
  buffer: readonly string[],
  cursor: number,
): { start: number; end: number; prefix: string } | undefined {
  let start = cursor;
  while (start > 0 && !/\s/u.test(buffer[start - 1] ?? '')) start -= 1;
  if (buffer[start] !== '/') return undefined;

  let end = cursor;
  while (end < buffer.length && !/\s/u.test(buffer[end] ?? '')) end += 1;
  return { start, end, prefix: buffer.slice(start, cursor).join('') };
}

function isNewlineShortcut(key: Key): boolean {
  if ((key.shift || key.meta) && (key.name === 'return' || key.name === 'enter')) return true;
  return key.sequence === '\x1b[13;2u'
    || key.sequence === '\x1b[13;3u'
    || key.sequence === '\x1b[27;2;13~';
}

function splitGraphemes(value: string): string[] {
  return [...segmenter.segment(value)].map(part => part.segment);
}

function findLineStart(buffer: readonly string[], cursor: number): number {
  const newline = buffer.lastIndexOf('\n', cursor - 1);
  return newline + 1;
}

function findLineEnd(buffer: readonly string[], cursor: number): number {
  const newline = buffer.indexOf('\n', cursor);
  return newline === -1 ? buffer.length : newline;
}

function getLineColumn(buffer: readonly string[], cursor: number): number {
  return displayWidth(buffer.slice(findLineStart(buffer, cursor), cursor));
}

function moveVertically(
  buffer: readonly string[],
  cursor: number,
  direction: -1 | 1,
  preferredColumn: number | undefined,
): number {
  const lineStart = findLineStart(buffer, cursor);
  const lineEnd = findLineEnd(buffer, cursor);
  const targetColumn = preferredColumn ?? getLineColumn(buffer, cursor);
  const targetStart = direction < 0
    ? findLineStart(buffer, Math.max(0, lineStart - 1))
    : Math.min(buffer.length, lineEnd + 1);
  if (targetStart === lineStart || targetStart > buffer.length) return cursor;
  const targetEnd = findLineEnd(buffer, targetStart);
  let width = 0;
  let target = targetStart;
  while (target < targetEnd) {
    const nextWidth = width + graphemeWidth(buffer[target] ?? '');
    if (nextWidth > targetColumn) break;
    width = nextWidth;
    target += 1;
  }
  return target;
}

function clearRenderedInput(output: Writable, cursorRow: number): void {
  output.write(`\r${cursorRow > 0 ? `\x1b[${cursorRow}A` : ''}\x1b[J`);
}

function getOutputColumns(output: Writable): number {
  const columns = (output as Writable & { columns?: number }).columns;
  return typeof columns === 'number' && columns > 0 ? columns : defaultColumns;
}

function getRenderedLineCount(value: string, columns: number): number {
  return Math.max(1, Math.ceil(displayWidth(splitGraphemes(value)) / columns));
}

function getVisualPosition(
  buffer: readonly string[],
  limit: number,
  columns: number,
): { row: number; column: number } {
  let row = 0;
  let column = displayWidth(splitGraphemes(prompt));
  for (let index = 0; index < limit; index += 1) {
    const grapheme = buffer[index] ?? '';
    if (grapheme === '\n') {
      row += 1;
      column = 0;
      continue;
    }
    const width = graphemeWidth(grapheme);
    if (column + width > columns) {
      row += 1;
      column = 0;
    }
    column += width;
  }
  return { row, column };
}

function displayWidth(graphemes: readonly string[]): number {
  return graphemes.reduce((width, grapheme) => width + graphemeWidth(grapheme), 0);
}

function graphemeWidth(grapheme: string): number {
  if (!grapheme || /^\p{Mark}+$/u.test(grapheme)) return 0;
  if (/\p{Extended_Pictographic}/u.test(grapheme)) return 2;
  const codePoint = grapheme.codePointAt(0) ?? 0;
  return isWideCodePoint(codePoint) ? 2 : 1;
}

function isWideCodePoint(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f ||
    codePoint === 0x2329 || codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

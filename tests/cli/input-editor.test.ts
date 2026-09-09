import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { readInteractiveMessage } from '../../src/cli/input-editor.js';

function interactiveInput() {
  return Object.assign(new PassThrough(), {
    isTTY: true as const,
    rawModes: [] as boolean[],
    setRawMode(enabled: boolean) { this.rawModes.push(enabled); },
  });
}

function output() {
  let text = '';
  const stream = Object.assign(new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  }), { isTTY: true, columns: 80 });
  return { stream, read: () => text };
}

describe('interactive input editor', () => {
  it('submits Enter and inserts a newline with distinguishable Shift+Enter', async () => {
    const input = interactiveInput();
    const target = output();
    const reading = readInteractiveMessage(input, target.stream, []);

    input.write('第一行\x1b[13;2u第二行\r');

    await expect(reading).resolves.toEqual({ type: 'submit', value: '第一行\n第二行' });
    expect(input.rawModes).toEqual([true, false]);
    expect(target.read()).toContain('you> 第一行\n第二行\n');
  });

  it('inserts a newline with Alt+Enter as a fallback', async () => {
    const input = interactiveInput();
    const reading = readInteractiveMessage(input, output().stream, []);

    input.write('第一行\x1b\r第二行\r');

    await expect(reading).resolves.toEqual({ type: 'submit', value: '第一行\n第二行' });
  });

  it('keeps bracketed and same-chunk multiline paste in one message', async () => {
    const bracketedInput = interactiveInput();
    const bracketed = readInteractiveMessage(bracketedInput, output().stream, []);
    bracketedInput.write('\x1b[200~a\nb\x1b[201~\r');
    await expect(bracketed).resolves.toEqual({ type: 'submit', value: 'a\nb' });

    const plainInput = interactiveInput();
    const plain = readInteractiveMessage(plainInput, output().stream, []);
    plainInput.write('c\nd\r');
    await expect(plain).resolves.toEqual({ type: 'submit', value: 'c\nd' });
  });

  it('edits whole graphemes and browses history in a single-line buffer', async () => {
    const editInput = interactiveInput();
    const edited = readInteractiveMessage(editInput, output().stream, []);
    editInput.write('你😀\x1b[D\x7f\r');
    await expect(edited).resolves.toEqual({ type: 'submit', value: '😀' });

    const historyInput = interactiveInput();
    const recalled = readInteractiveMessage(historyInput, output().stream, ['old']);
    historyInput.write('\x1b[A\r');
    await expect(recalled).resolves.toEqual({ type: 'submit', value: 'old' });
  });

  it('supports Home, End, Delete, and vertical movement in multiline input', async () => {
    const lineInput = interactiveInput();
    const editedLine = readInteractiveMessage(lineInput, output().stream, []);
    lineInput.write('abc\x1b[H\x1b[3~\x1b[F\x1b[D\x1b[3~\r');
    await expect(editedLine).resolves.toEqual({ type: 'submit', value: 'b' });

    const multilineInput = interactiveInput();
    const editedMultiline = readInteractiveMessage(multilineInput, output().stream, []);
    multilineInput.write('abc\x1b[13;2uxy\x1b[AZ\x1b[B!\r');
    await expect(editedMultiline).resolves.toEqual({ type: 'submit', value: 'abZc\nxy!' });
  });

  it('ignores Ctrl+C and exits on standalone Esc', async () => {
    const input = interactiveInput();
    const reading = readInteractiveMessage(input, output().stream, []);
    input.write('\x03\x1b');
    await expect(reading).resolves.toEqual({ type: 'exit' });
  });
});

import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { readInteractiveMessage } from '../../src/cli/input-editor.js';

const commandSuggestions = [
  { name: '/new', description: '开启新会话' },
  { name: '/sessions', description: '选择历史会话' },
  { name: '/exit', description: '退出 Isla' },
];

function interactiveInput() {
  return Object.assign(new PassThrough(), {
    isTTY: true as const,
    rawModes: [] as boolean[],
    setRawMode(enabled: boolean) { this.rawModes.push(enabled); },
  });
}

function output(columns = 80) {
  let text = '';
  const stream = Object.assign(new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  }), { isTTY: true, columns });
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

  it('shows matching commands and completes a unique match with Tab', async () => {
    const input = interactiveInput();
    const target = output();
    const reading = readInteractiveMessage(
      input,
      target.stream,
      [],
      '',
      commandSuggestions,
    );

    input.write('/s\t\r');

    await expect(reading).resolves.toEqual({ type: 'submit', value: '/sessions' });
    expect(target.read()).toContain('you> /\n/new  开启新会话\n/sessions  选择历史会话\n/exit  退出 Isla');
    expect(target.read()).toContain('you> /s\n/sessions  选择历史会话');
    expect(target.read()).toContain('/sessions');
  });

  it('counts wrapped command descriptions when restoring the cursor', async () => {
    const input = interactiveInput();
    const target = output(20);
    const reading = readInteractiveMessage(input, target.stream, [], '', commandSuggestions);

    input.write('/s');
    expect(target.read()).toContain('\x1b[2A');
    input.write('\t\r');

    await expect(reading).resolves.toEqual({ type: 'submit', value: '/sessions' });
  });

  it('completes a slash token after whitespace or a newline without replacing the message', async () => {
    const inlineInput = interactiveInput();
    const inline = readInteractiveMessage(
      inlineInput,
      output().stream,
      [],
      '',
      commandSuggestions,
    );
    inlineInput.write('请使用 /s\t 继续\r');
    await expect(inline).resolves.toEqual({ type: 'submit', value: '请使用 /sessions 继续' });

    const multilineInput = interactiveInput();
    const multiline = readInteractiveMessage(
      multilineInput,
      output().stream,
      [],
      '',
      commandSuggestions,
    );
    multilineInput.write('下一行\x1b\r/e\t\r');
    await expect(multiline).resolves.toEqual({ type: 'submit', value: '下一行\n/exit' });
  });

  it('does not treat a slash inside another token as a completion trigger', async () => {
    const input = interactiveInput();
    const target = output();
    const reading = readInteractiveMessage(
      input,
      target.stream,
      [],
      '',
      commandSuggestions,
    );
    input.write('https://example.test/s\t\r');
    await expect(reading).resolves.toEqual({ type: 'submit', value: 'https://example.test/s' });
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

  it('exits on Ctrl+C or standalone Esc while idle', async () => {
    const input = interactiveInput();
    const target = output();
    const reading = readInteractiveMessage(input, target.stream, []);
    input.write('\x03');
    await expect(reading).resolves.toEqual({ type: 'exit' });
    expect(target.read().endsWith('\n')).toBe(true);
    expect(input.isPaused()).toBe(true);
  });
});

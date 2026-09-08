import { emitKeypressEvents, type Key } from 'node:readline';
import type { Writable } from 'node:stream';
import type { StoredSession } from '../session-store.js';
import {
  isInteractiveInput,
  type CliCommand,
  type InteractiveInput,
} from './command.js';

export const sessionsCommand: CliCommand = {
  name: '/sessions',
  inputMode: 'raw',
  async execute(context) {
    const sessions = await context.sessionStore.list(context.providerId, context.model);
    if (!isInteractiveInput(context.input)) {
      writeSessionList(context.output, sessions, context.currentSession.id);
      return { type: 'continue' };
    }

    const selected = await selectSession(
      context.input,
      context.output,
      sessions,
      context.currentSession.id,
    );
    if (selected === 'exit') return { type: 'exit' };
    if (!selected || selected.id === context.currentSession.id) return { type: 'continue' };
    return { type: 'switch-session', session: selected, replayHistory: true };
  },
};

function selectSession(
  input: InteractiveInput,
  output: Writable,
  sessions: readonly StoredSession[],
  currentId: string,
): Promise<StoredSession | 'exit' | undefined> {
  if (sessions.length === 0) return Promise.resolve(undefined);
  const pageSize = 10;
  let selectedIndex = Math.max(0, sessions.findIndex(session => session.id === currentId));
  emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  output.write('\x1b[?1049h');

  const render = () => {
    const pageStart = Math.floor(selectedIndex / pageSize) * pageSize;
    const visibleSessions = sessions.slice(pageStart, pageStart + pageSize);
    output.write('\x1b[2J\x1b[H选择会话  ↑↓ 移动  PgUp/PgDn 翻页  Enter 确认  Esc 取消\n\n');
    visibleSessions.forEach((stored, index) => {
      const absoluteIndex = pageStart + index;
      const cursor = absoluteIndex === selectedIndex ? '>' : ' ';
      const current = stored.id === currentId ? '*' : ' ';
      output.write(`${cursor}${current} ${formatSessionSummary(stored)}\n`);
    });
  };

  render();
  return new Promise(resolve => {
    const finish = (result: StoredSession | 'exit' | undefined) => {
      input.removeListener('keypress', onKeypress);
      input.setRawMode(false);
      output.write('\x1b[?1049l');
      resolve(result);
    };
    const onKeypress = (_text: string, key: Key) => {
      if (key.ctrl && key.name === 'c') {
        finish('exit');
        return;
      }
      if (key.name === 'escape') {
        finish(undefined);
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        finish(sessions[selectedIndex]);
        return;
      }
      if (key.name === 'up') selectedIndex = Math.max(0, selectedIndex - 1);
      else if (key.name === 'down') selectedIndex = Math.min(sessions.length - 1, selectedIndex + 1);
      else if (key.name === 'pageup') selectedIndex = Math.max(0, selectedIndex - pageSize);
      else if (key.name === 'pagedown') selectedIndex = Math.min(sessions.length - 1, selectedIndex + pageSize);
      else return;
      render();
    };
    input.on('keypress', onKeypress);
  });
}

function writeSessionList(
  output: Writable,
  sessions: readonly StoredSession[],
  currentId: string,
): void {
  output.write('会话列表：\n');
  sessions.forEach(stored => {
    output.write(`${stored.id === currentId ? '*' : ' '} ${formatSessionSummary(stored)}\n`);
  });
  output.write('\n');
}

function formatSessionSummary(session: StoredSession): string {
  const turns = session.messages.filter(message => message.role === 'user').length;
  const firstUserMessage = session.messages.find(message => message.role === 'user')?.content;
  const preview = firstUserMessage ? firstUserMessage.replaceAll(/\s+/g, ' ').slice(0, 40) : '新对话';
  return `${formatSessionTime(session.updatedAt)} · ${turns}轮 · ${preview}`;
}

function formatSessionTime(value: string): string {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

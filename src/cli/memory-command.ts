import type { CliCommand } from './command.js';
import { emitKeypressEvents, type Key } from 'node:readline';
import { isInteractiveInput, type InteractiveInput } from './command.js';
import { MemoryStore } from '../memory/store.js';

export const memoryCommand: CliCommand = {
  name: '/memory', description: '查看和管理长期记忆', inputMode: 'raw',
  async execute(context) {
    const store = context.memoryStore ?? new MemoryStore();
    const tokens = (context.commandLine ?? '/memory').trim().split(/\s+/);
    const action = tokens[1] ?? 'list';
    if (action === 'list' && isInteractiveInput(context.input)) {
      await browseMemory(context.input, context.output, store); return { type: 'continue' };
    }
    if (action === 'list') {
      const records = store.list({ ...(tokens[2] ? { status: tokens[2] } : {}) });
      context.output.write('长期记忆：\n');
      for (const record of records) context.output.write(`${record.id} · ${record.status} · ${record.kind} · ${record.content}\n`);
      context.output.write(records.length ? '\n' : '（暂无记忆）\n\n');
      return { type: 'continue' };
    }
    if (action === 'search' && tokens[2]) {
      const records = store.list().filter(record => record.status !== 'disabled' && record.status !== 'superseded' && record.content.toLocaleLowerCase().includes(tokens.slice(2).join(' ').toLocaleLowerCase()));
      for (const record of records) context.output.write(`${record.id} · ${record.status} · ${record.content}\n`);
      if (!records.length) context.output.write('（无匹配记忆）\n');
      return { type: 'continue' };
    }
    if (action === 'add' && tokens[2] && tokens.slice(3).join(' ').trim()) {
      const record = store.create({ scope: 'global', kind: tokens[2] as never, content: tokens.slice(3).join(' '), provenance: 'explicit-user', source: { type: 'manual' } });
      context.output.write(`已新增：${record.id}\n`); return { type: 'continue' };
    }
    if (action === 'show' && tokens[2]) {
      const record = store.get(tokens[2]);
      context.output.write(record ? `${JSON.stringify(record, null, 2)}\n` : `未找到记忆：${tokens[2]}\n`);
      return { type: 'continue' };
    }
    if (action === 'disable' && tokens[2]) {
      const record = store.get(tokens[2]);
      if (!record) context.output.write(`未找到记忆：${tokens[2]}\n`);
      else { store.disable(record.id, record.revision); context.output.write(`已停用：${record.id}\n`); }
      return { type: 'continue' };
    }
    if (action === 'enable' && tokens[2]) {
      const record = store.get(tokens[2]);
      if (!record) context.output.write(`未找到记忆：${tokens[2]}\n`);
      else { const updated = store.update(record.id, { expectedRevision: record.revision, status: 'active' }); context.output.write(`已启用：${updated.id}\n`); }
      return { type: 'continue' };
    }
    if (action === 'edit' && tokens[2] && tokens.slice(3).join(' ').trim()) {
      const record = store.get(tokens[2]);
      if (!record) context.output.write(`未找到记忆：${tokens[2]}\n`);
      else { const updated = store.update(record.id, { expectedRevision: record.revision, content: tokens.slice(3).join(' ') }); context.output.write(`已修改：${updated.id}\n`); }
      return { type: 'continue' };
    }
    if (action === 'revisions' && tokens[2]) {
      for (const revision of store.revisions(tokens[2])) context.output.write(`${revision.revision} · ${revision.action} · ${revision.createdAt}\n`);
      return { type: 'continue' };
    }
    if (action === 'restore' && tokens[2] && Number.isInteger(Number(tokens[3]))) {
      const record = store.get(tokens[2]);
      if (!record) context.output.write(`未找到记忆：${tokens[2]}\n`);
      else { const restored = store.restoreRevision(record.id, Number(tokens[3]), record.revision); context.output.write(`已恢复：${restored.id}\n`); }
      return { type: 'continue' };
    }
    if (action === 'blocks') {
      for (const name of ['persona', 'user', 'workspace'] as const) { const block = store.getBlock(name); if (block) context.output.write(`${name} · ${block.content}\n`); }
      return { type: 'continue' };
    }
    if (action === 'preview') {
      const preview = await context.memoryRuntime?.buildRequestContext(tokens.slice(2).join(' ') || '当前请求', process.cwd());
      context.output.write(preview ? `${preview}\n` : '下一请求没有可加载的长期记忆。\n');
      return { type: 'continue' };
    }
    if (action === 'block' && tokens[2] && tokens[3] === 'show') {
      const block = store.getBlock(tokens[2] as never); context.output.write(block ? `${block.name} · ${block.content}\n` : `未找到 Block：${tokens[2]}\n`); return { type: 'continue' };
    }
    if (action === 'block' && tokens[2] && tokens[3] === 'edit' && tokens.slice(4).join(' ').trim()) {
      const block = store.getBlock(tokens[2] as never);
      if (!block) context.output.write(`未找到 Block：${tokens[2]}\n`);
      else { store.saveBlock(block.name, tokens.slice(4).join(' '), block.budget); context.output.write(`已修改 Block：${block.name}\n`); }
      return { type: 'continue' };
    }
    context.output.write('用法：/memory list|search <词>|add <kind> <内容>|show <id>|edit <id> <内容>|enable <id>|disable <id>|revisions <id>|restore <id> <revision>|blocks|block <name> show|edit <内容>\n');
    return { type: 'continue' };
  },
};

async function browseMemory(input: InteractiveInput, output: NodeJS.WritableStream, store: MemoryStore): Promise<void> {
  const records = store.list(); if (!records.length) { output.write('\x1b[?1049h\x1b[2J\x1b[H暂无长期记忆，按 Esc 返回\n'); await waitForEscape(input, output); return; }
  let selected = 0; emitKeypressEvents(input); input.setRawMode(true); input.resume(); output.write('\x1b[?1049h');
  const render = () => { output.write('\x1b[2J\x1b[H长期记忆  ↑↓ 选择  Enter 查看  d 停用  e 启用  Esc 返回\n\n'); records.forEach((record, index) => output.write(`${index === selected ? '>' : ' '} ${record.status.padEnd(10)} ${record.kind.padEnd(12)} ${record.content.slice(0, 70)}\n`)); };
  render();
  await new Promise<void>(resolve => {
    const finish = () => { input.removeListener('keypress', onKeypress); input.setRawMode(false); output.write('\x1b[?1049l'); resolve(); };
    const onKeypress = (_text: string, key: Key) => { const record = records[selected]!; if (key.name === 'escape' || (key.ctrl && key.name === 'c')) { finish(); return; } if (key.name === 'up') selected = Math.max(0, selected - 1); else if (key.name === 'down') selected = Math.min(records.length - 1, selected + 1); else if (key.name === 'return' || key.name === 'enter') { output.write(`\n${JSON.stringify(record, null, 2)}\n按 Esc 返回\n`); return; } else if (key.sequence === 'd' && record.status !== 'disabled') { records[selected] = store.disable(record.id, record.revision); } else if (key.sequence === 'e' && record.status === 'candidate') { records[selected] = store.update(record.id, { expectedRevision: record.revision, status: 'active' }); } else return; render(); };
    input.on('keypress', onKeypress);
  });
}

function waitForEscape(input: InteractiveInput, output: NodeJS.WritableStream): Promise<void> { emitKeypressEvents(input); input.setRawMode(true); input.resume(); return new Promise(resolve => { const onKeypress = (_text: string, key: Key) => { if (key.name === 'escape' || (key.ctrl && key.name === 'c')) { input.removeListener('keypress', onKeypress); input.setRawMode(false); output.write('\x1b[?1049l'); resolve(); } }; input.on('keypress', onKeypress); }); }

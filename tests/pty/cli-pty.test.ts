import { describe, expect, it } from 'vitest';
import { access, readFile } from 'node:fs/promises';
import { createPtyFixture } from '../support/pty-fixture.js';
import { PTY_AVAILABLE } from '../support/pty-driver.js';

describe.skipIf(!PTY_AVAILABLE)('CLI PTY acceptance', () => {
  it('handles an ordinary prompt and returns to the input editor', async () => {
    const fixture = await createPtyFixture();
    try {
      fixture.server.enqueue({ content: 'ready' });
      fixture.driver.enter('hello Isla');
      await fixture.driver.waitForText('isla> ready');
      await fixture.driver.waitForText('you>');
      fixture.driver.enter('/exit');
      expect((await fixture.driver.waitForExit()).exitCode).toBe(0);
    } finally { await fixture.dispose(); }
  }, 30_000);

  it('runs /skills and previews without a provider request', async () => {
    const fixture = await createPtyFixture();
    try {
      const before = fixture.server.requestCount;
      fixture.driver.enter('/skills');
      await fixture.driver.waitForText('fixture-review');
      fixture.driver.enter('/skills fixture-review');
      await fixture.driver.waitForText('<skill_content name="fixture-review">');
      expect(fixture.server.requestCount).toBe(before);
      fixture.driver.enter('/exit');
      expect((await fixture.driver.waitForExit()).exitCode).toBe(0);
    } finally { await fixture.dispose(); }
  }, 30_000);

  it('invokes a Skill through the real interactive CLI', async () => {
    const fixture = await createPtyFixture();
    try {
      fixture.server.enqueue({ content: 'ready' });
      fixture.driver.enter('/skill fixture-review 请检查 fixture');
      await fixture.driver.waitForText('isla> ready');
      fixture.driver.enter('/exit');
      expect((await fixture.driver.waitForExit()).exitCode).toBe(0);
    } finally { await fixture.dispose(); }
  }, 30_000);

  it('starts a new session and can continue chatting', async () => {
    const fixture = await createPtyFixture();
    try {
      fixture.server.enqueue({ content: 'before new' }, { content: 'after new' });
      fixture.driver.enter('before');
      await fixture.driver.waitForText('isla> before new');
      fixture.driver.enter('/new');
      await fixture.driver.waitForText('you>');
      fixture.driver.enter('after');
      await fixture.driver.waitForText('isla> after new');
      fixture.driver.enter('/exit');
      expect((await fixture.driver.waitForExit()).exitCode).toBe(0);
    } finally { await fixture.dispose(); }
  }, 30_000);

  it('cancels a delayed turn with Ctrl+C and returns to the prompt', async () => {
    const fixture = await createPtyFixture();
    try {
      fixture.server.enqueue({ content: 'late', delayMs: 4_000 });
      fixture.driver.enter('please wait');
      await fixture.driver.waitForText('生成中');
      fixture.driver.sendCtrlC();
      await fixture.driver.waitForText('正在取消本轮');
      await fixture.driver.waitForText('you>', { from: fixture.driver.textOutput.length, timeoutMs: 8_000 });
      fixture.driver.enter('/exit');
      await fixture.driver.waitForExit();
    } finally { await fixture.dispose(); }
  }, 30_000);

  it('exits from the idle editor with Escape', async () => {
    const fixture = await createPtyFixture();
    try {
      fixture.driver.sendEscape();
      expect((await fixture.driver.waitForExit()).exitCode).toBe(0);
    } finally { await fixture.dispose(); }
  }, 30_000);

  it('rejects a write Tool Call through the interactive Approval prompt', async () => {
    const fixture = await createPtyFixture();
    try {
      fixture.server.enqueue({ toolCalls: [{ id: 'call-1', name: 'write_text_file', arguments: JSON.stringify({ path: 'approval.txt', content: 'blocked' }) }] });
      fixture.driver.enter('please write the file');
      await fixture.driver.waitForText('Isla 请求执行');
      fixture.driver.sendEscape();
      await fixture.driver.waitForText('用户拒绝了工具调用');
      await expect(access(`${fixture.workspace}/approval.txt`).then(() => true, () => false)).resolves.toBe(false);
      await fixture.driver.waitForText('you>', { from: fixture.driver.textOutput.length - 20 });
    } finally { await fixture.dispose(); }
  }, 30_000);

  it('approves a write Tool Call and persists the file in the workspace', async () => {
    const fixture = await createPtyFixture();
    try {
      fixture.server.enqueue(
        { toolCalls: [{ id: 'call-approve', name: 'write_text_file', arguments: JSON.stringify({ path: 'approved.txt', content: 'allowed' }) }] },
        { content: 'ready' },
      );
      fixture.driver.enter('please write the file');
      await fixture.driver.waitForText('Isla 请求执行');
      fixture.driver.write('y');
      await fixture.driver.waitForText('isla> ready');
      await expect(readFile(`${fixture.workspace}/approved.txt`, 'utf8')).resolves.toBe('allowed');
    } finally { await fixture.dispose(); }
  }, 30_000);

  it('configures an MCP server through the interactive setup wizard', async () => {
    const fixture = await createPtyFixture({ withMcp: true });
    try {
      fixture.driver.enter('/mcp setup');
      await fixture.driver.waitForText('MCP 操作');
      fixture.driver.enter('remove');
      await fixture.driver.waitForText('Server id:');
      fixture.driver.enter('fixture');
      await fixture.driver.waitForText('确认删除 fixture');
      fixture.driver.enter('y');
      await fixture.driver.waitForText('保存 MCP 配置');
      fixture.driver.enter('y');
      await fixture.driver.waitForText('下次启动 Isla 时生效');
      fixture.driver.enter('/exit');
      expect((await fixture.driver.waitForExit()).exitCode).toBe(0);
    } finally { await fixture.dispose(); }
  }, 30_000);

  it('remembers an approved tool and skips the second same-tool prompt', async () => {
    const fixture = await createPtyFixture();
    try {
      const call = (id: string, path: string, content: string) => ({ toolCalls: [{ id, name: 'write_text_file', arguments: JSON.stringify({ path, content }) }] });
      fixture.server.enqueue(call('call-a1', 'remembered-one.txt', 'one'), { content: 'first done' }, call('call-a2', 'remembered-two.txt', 'two'), { content: 'second done' });
      fixture.driver.enter('write the first file');
      await fixture.driver.waitForText('Isla 请求执行');
      fixture.driver.write('a');
      await fixture.driver.waitForText('验证：未运行');
      const beforeSecond = fixture.driver.textOutput.length;
      await fixture.driver.waitForText('验证：未运行');
      expect(fixture.driver.textOutput.slice(beforeSecond)).not.toContain('Isla 请求执行');
      await expect(readFile(`${fixture.workspace}/remembered-one.txt`, 'utf8')).resolves.toBe('one');
      await expect(readFile(`${fixture.workspace}/remembered-two.txt`, 'utf8')).resolves.toBe('two');
    } finally { await fixture.dispose(); }
  }, 30_000);
});

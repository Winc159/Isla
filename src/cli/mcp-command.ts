import { isInteractiveInput, type CliCommand, type InteractiveInput } from './command.js';
import { createInterface } from 'node:readline/promises';
import { fingerprintMcpServers, projectMcpDiagnostic } from '../mcp/diagnostics.js';
import { listMcpConfig, saveMcpServers } from '../mcp/profile-config.js';
import type { McpServerConfig } from '../mcp/types.js';

export const mcpCommand: CliCommand = {
  name: '/mcp',
  description: '查看 MCP Server 与工具状态',
  usage: '/mcp [check [server-id]]',
  inputMode: 'line',
  async execute(context) {
    const line = context.commandLine?.trim() ?? '/mcp';
    const parts = line.split(/\s+/);
    const subcommand = parts[1];
    if (subcommand === 'setup') {
      await runMcpSetup(context);
      return { type: 'continue' };
    }
    if (subcommand === 'config') {
      if (!context.configStore || !context.profileName) { context.output.write('当前运行没有可编辑的 Profile 配置。\n'); return { type: 'continue' }; }
      const loaded = await context.configStore.load();
      if (loaded.status !== 'ready') { context.output.write(`配置不可用：${loaded.status === 'invalid' || loaded.status === 'unreadable' ? loaded.message : '未找到可用 Profile'}\n`); return { type: 'continue' }; }
      const entries = listMcpConfig(loaded.config, context.profileName);
      context.output.write(`Profile：${context.profileName}\nMCP 配置：${entries.length ? '' : '未配置'}\n`);
      for (const item of entries) context.output.write(`  ${item.id} · ${item.required ? 'required' : 'optional'} · args=${item.argsCount} · env=${item.envKeys.length || item.sensitiveEnvCount ? `${item.envKeys.length} 个公开 key${item.sensitiveEnvCount ? `、secret(${item.sensitiveEnvCount})` : ''}（值已隐藏）` : '无'} · timeout=${item.startupTimeoutMs}/${item.callTimeoutMs}\n`);
      const configuredServers = loaded.config.profiles[context.profileName]?.mcp?.servers;
      const restartRequired = context.mcpHost ? fingerprintMcpServers(configuredServers) !== context.mcpHost.configFingerprint : false;
      context.output.write(`${restartRequired ? '当前 MCP 配置已改变，请重启 Isla。' : '当前 MCP 配置与本次启动一致。'}\n`);
      return { type: 'continue' };
    }
    if (subcommand && subcommand !== 'check') {
      context.output.write(`未知 MCP 命令：${subcommand}。可用命令：/mcp、/mcp check [server-id]、/mcp config、/mcp setup。\n`);
      return { type: 'continue' };
    }
    const requestedId = parts[2];
    if (parts.length > 3 || (requestedId && !/^[A-Za-z0-9_-]{1,64}$/.test(requestedId))) {
      context.output.write('用法：/mcp 或 /mcp check [server-id]\n');
      return { type: 'continue' };
    }
    const statuses = context.mcpHost?.statuses() ?? [];
    const status = requestedId ? statuses.find(item => item.id === requestedId) : undefined;
    if (requestedId && !status) {
      context.output.write(`未找到 MCP Server：${requestedId}\n`);
      return { type: 'continue' };
    }
    if (!statuses.length) {
      context.output.write('当前未启用 MCP Server。\n');
      return { type: 'continue' };
    }
    const diagnostics = (status ? [projectMcpDiagnostic(status)] : statuses.map(projectMcpDiagnostic));
    const loaded = context.profileName && context.configStore ? await context.configStore.load() : undefined;
    const configuredServers = loaded?.status === 'ready' && context.profileName ? loaded.config.profiles[context.profileName]?.mcp?.servers : undefined;
    const restartRequired = context.mcpHost && configuredServers
      ? fingerprintMcpServers(configuredServers) !== context.mcpHost.configFingerprint
      : false;
    if (restartRequired) context.output.write('当前 MCP 配置已改变，请重启 Isla 后再检查运行状态。\n');
    for (const item of diagnostics) {
      context.output.write(`${item.id} · ${item.state} · tools=${item.toolCount}${item.errorCode ? ` · ${item.errorCode}` : ''}\n`);
      for (const tool of item.tools) context.output.write(`  - ${tool}\n`);
      if (item.recommendation) context.output.write(`  建议：${item.recommendation}\n`);
    }
    return { type: 'continue' };
  },
};

async function runMcpSetup(context: Parameters<CliCommand['execute']>[0]): Promise<void> {
  if (!context.configStore || !context.profileName || !context.configPath) { context.output.write('当前运行没有可编辑的 Profile 配置。\n'); return; }
  if (!isInteractiveInput(context.input)) { context.output.write('MCP 配置向导需要交互式终端。\n'); return; }
  const loaded = await context.configStore.load();
  if (loaded.status !== 'ready') { context.output.write('配置不可用，未写入任何内容。\n'); return; }
  const profile = loaded.config.profiles[context.profileName];
  if (!profile) { context.output.write(`未找到 Profile：${context.profileName}\n`); return; }
  const current = [...(profile.mcp?.servers ?? [])];
  const rl = createInterface({ input: context.input, output: context.output });
  try {
    const action = (await rl.question('MCP 操作（add/edit/remove/cancel）: ')).trim().toLowerCase();
    if (action === 'cancel' || !action) { context.output.write('已取消，未写入配置。\n'); return; }
    const id = (await rl.question('Server id: ')).trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) { context.output.write('Server id 无效，未写入配置。\n'); return; }
    const index = current.findIndex(item => item.id === id);
    if (action === 'remove') {
      if (index < 0) { context.output.write(`未找到 Server：${id}\n`); return; }
      if ((await rl.question(`确认删除 ${id}？(y/N): `)).trim().toLowerCase() !== 'y') { context.output.write('已取消，未写入配置。\n'); return; }
      current.splice(index, 1);
    } else if (action === 'add' || action === 'edit') {
      if (action === 'add' && index >= 0) { context.output.write(`Server 已存在：${id}\n`); return; }
      if (action === 'edit' && index < 0) { context.output.write(`未找到 Server：${id}\n`); return; }
      const old = index >= 0 ? current[index] : undefined;
      const command = (await rl.question(`command${old ? ` [${old.command}]` : ''}: `)).trim() || old?.command;
      if (!command) { context.output.write('command 不能为空，未写入配置。\n'); return; }
      const args = await promptArguments(rl, old?.args ?? []);
      if (!args) { context.output.write('args 输入无效，未写入配置。\n'); return; }
      const cwdInput = (await rl.question(`cwd（留空表示无；workspace 或绝对路径）${old?.cwd ? ` [${old.cwd}]` : ''}: `)).trim();
      const cwd = cwdInput || old?.cwd;
      const requiredInput = (await rl.question(`required（y/N）${old?.required ? ' [y]' : ''}: `)).trim().toLowerCase();
      const required = requiredInput ? requiredInput === 'y' : (old?.required ?? false);
      const startupInput = (await rl.question(`startupTimeoutMs${old ? ` [${old.startupTimeoutMs}]` : ' [10000]'}: `)).trim();
      const callInput = (await rl.question(`callTimeoutMs${old ? ` [${old.callTimeoutMs}]` : ' [60000]'}: `)).trim();
      const startupTimeoutMs = Number(startupInput || old?.startupTimeoutMs || 10_000);
      const callTimeoutMs = Number(callInput || old?.callTimeoutMs || 60_000);
      if (!Number.isInteger(startupTimeoutMs) || startupTimeoutMs <= 0 || !Number.isInteger(callTimeoutMs) || callTimeoutMs <= 0) { context.output.write('timeout 必须是正整数，未写入配置。\n'); return; }
      const env = await promptEnvironment(rl, context.input, context.output, old?.env ?? {});
      if (!env) { context.output.write('已取消，未写入配置。\n'); return; }
      const next: McpServerConfig = { id, transport: 'stdio', command, args, ...(cwd ? { cwd } : {}), required, startupTimeoutMs, callTimeoutMs, env };
      if (index >= 0) current[index] = next; else current.push(next);
    } else { context.output.write('用法：add、edit、remove 或 cancel。\n'); return; }
    if ((await rl.question('保存 MCP 配置？(y/N): ')).trim().toLowerCase() !== 'y') { context.output.write('已取消，未写入配置。\n'); return; }
    await saveMcpServers(context.configStore, context.profileName, current, loaded.revision);
    context.output.write('MCP 配置已保存，下次启动 Isla 时生效。\n');
  } finally { rl.close(); }
}

async function promptArguments(rl: ReturnType<typeof createInterface>, existing: readonly string[]): Promise<string[] | undefined> {
  const countText = (await rl.question(`args 数量${existing.length ? ` [${existing.length}]` : ' [0]'}: `)).trim();
  const count = countText ? Number(countText) : existing.length;
  if (!Number.isInteger(count) || count < 0 || count > 64) return undefined;
  const result: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const value = (await rl.question(`args[${index + 1}]${existing[index] !== undefined ? ` [${existing[index]}]` : ''}: `)).trim();
    result.push(value || existing[index] || '');
  }
  return result;
}

async function promptEnvironment(rl: ReturnType<typeof createInterface>, input: InteractiveInput, output: NodeJS.WritableStream, existing: Readonly<Record<string, string>>): Promise<Record<string, string> | undefined> {
  const keys = Object.keys(existing);
  const countText = await rl.question(`env key 数量${keys.length ? ` [${keys.length}]` : ' [0]'}: `);
  const count = countText.trim() ? Number(countText.trim()) : keys.length;
  if (!Number.isInteger(count) || count < 0 || count > 32) { output.write('env key 数量必须是 0 到 32。\n'); return undefined; }
  const result: Record<string, string> = {};
  for (let index = 0; index < count; index += 1) {
    const key = (await rl.question(`env[${index + 1}] key${keys[index] ? ` [${keys[index]}]` : ''}: `)).trim() || keys[index];
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) { output.write('env key 无效。\n'); return undefined; }
    const value = await readSecretValue(input, output, `env[${key}] value${existing[key] ? '（已配置，重新输入以替换）' : ''}: `);
    if (value === undefined) return undefined;
    result[key] = value === '' && existing[key] !== undefined ? existing[key] : value;
  }
  return result;
}

function readSecretValue(input: InteractiveInput, output: NodeJS.WritableStream, prompt: string): Promise<string | undefined> {
  output.write(prompt);
  input.setRawMode(true);
  input.resume();
  return new Promise(resolve => {
    let value = '';
    const finish = (result: string | undefined) => { input.removeListener('data', onData); input.setRawMode(false); input.pause(); output.write('\n'); resolve(result); };
    const onData = (chunk: Buffer | string) => {
      const text = chunk.toString();
      if (text === '\u0003' || text === '\u001b') return finish(undefined);
      if (text === '\r' || text === '\n') return finish(value);
      if (text === '\u007f' || text === '\b') { value = value.slice(0, -1); return; }
      if (!text.includes('\u0000')) value += text;
    };
    input.on('data', onData);
  });
}

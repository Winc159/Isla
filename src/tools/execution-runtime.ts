import { relative } from 'node:path';
import { basename, delimiter, join, extname } from 'node:path';
import { access, constants } from 'node:fs/promises';
import { platform, release, arch } from 'node:os';
import { invalidArguments, ToolFailure } from './errors.js';
import type { Tool, ToolCapability, ToolOutput } from './types.js';
import { ExecutionProcessRegistry } from './process-registry.js';
import type { ManagedProcessStatus } from './process-registry.js';

export function createExecutionRuntimeCapability(registry: ExecutionProcessRegistry, workspaceRoot: string, ownerId: () => string): ToolCapability {
  return { id: 'execution-runtime', instructions: '先用 exec_environment 确认平台和依赖命令是否存在。长时间命令用 exec_start 启动，记录 processId；用 exec_read 以 cursor 读取输出，用 exec_status 轮询状态，需要向交互进程输入时用 exec_write，需要停止时用 exec_cancel。所有命令必须使用 executable 与 argv 数组，不要构造 Shell 字符串。', tools: [environmentTool(), startTool(registry, workspaceRoot, ownerId), readTool(registry, ownerId), writeTool(registry, ownerId), cancelTool(registry, ownerId), statusTool(registry, workspaceRoot, ownerId)] };
}

function environmentTool(): Tool {
  return { definition: { name: 'exec_environment', description: '读取本机运行平台摘要，并检查 PATH 中指定命令是否可用；不返回 PATH 实际内容。', parameters: { type: 'object', properties: { commands: { type: 'array', items: { type: 'string', pattern: '^[A-Za-z0-9._+-]{1,100}$' }, maxItems: 20 } }, additionalProperties: false } },
    execute: async args => {
      const value = parseObject(args);
      const commands = value.commands ?? [];
      if (!Array.isArray(commands) || commands.length > 20 || commands.some(command => typeof command !== 'string' || !/^[A-Za-z0-9._+-]{1,100}$/u.test(command))) throw invalidArguments('commands must be at most 20 simple executable names');
      const pathEntries = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
      const extensions = process.platform === 'win32' ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';') : [''];
      const available = await Promise.all(commands.map(async command => ({ command, available: await commandExists(command, pathEntries, extensions) })));
      const shell = process.env.SHELL || process.env.ComSpec || '';
      return JSON.stringify({ platform: platform(), architecture: arch(), release: release(), shell: shell ? basename(shell) : 'unknown', pathEntryCount: pathEntries.length, commands: available });
    } };
}

async function commandExists(command: string, pathEntries: readonly string[], extensions: readonly string[]): Promise<boolean> {
  const candidates = extname(command) ? [''] : extensions;
  for (const directory of pathEntries) for (const extension of candidates) {
    try { await access(join(directory, `${command}${extension}`), process.platform === 'win32' ? constants.F_OK : constants.X_OK); return true; }
    catch { /* 不暴露路径，只汇总是否存在。 */ }
  }
  return false;
}

function startTool(registry: ExecutionProcessRegistry, workspaceRoot: string, ownerId: () => string): Tool {
  return { definition: { name: 'exec_start', description: '在 Workspace 内启动可持续运行的 argv 进程；交互式程序可请求 tty，也可选择容器或受管工具链执行器。', parameters: { type: 'object', properties: { executable: { type: 'string' }, argv: { type: 'array', items: { type: 'string' } }, workdir: { type: 'string' }, timeoutMs: { type: 'number' }, tty: { type: 'boolean' }, adapter: { type: 'string', enum: ['local', 'managed-toolchain', 'container'] }, dependencyId: { type: 'string' }, executableId: { type: 'string' } }, required: ['executable', 'argv'], additionalProperties: false } }, permission: { kind: 'command-execute' },
    describe: args => { const value = parse(args); return `启动命令（执行器：${value.adapter ?? '默认'}；工作目录：${value.workdir ?? '.'}${value.tty ? '；交互式 TTY' : ''}）：${[value.executable, ...value.argv].join(' ').slice(0, 240)}`; },
    execute: async args => { const value = parse(args); try { const status = await registry.start({ workspaceRoot, ownerId: ownerId(), ...value }); return { content: JSON.stringify(publicStatus(status, workspaceRoot)), details: { type: 'execution_runtime', processId: status.processId, state: status.state, outputCursor: status.outputCursor } }; } catch (error) { throw new ToolFailure('COMMAND_EXECUTION_FAILED', safeError(error)); } } };
}
function readTool(registry: ExecutionProcessRegistry, ownerId: () => string): Tool {
  return { definition: { name: 'exec_read', description: '按 cursor 读取进程输出的有界增量；limitBytes 最小 4096。', parameters: { type: 'object', properties: { processId: { type: 'string' }, afterCursor: { type: 'integer', minimum: 0 }, limitBytes: { type: 'integer', minimum: 4096, maximum: 64000 } }, required: ['processId'], additionalProperties: false } },
    execute: async args => { const value = parseObject(args); try { return JSON.stringify(registry.read(string(value.processId), integer(value.afterCursor, 0), integer(value.limitBytes, 32_000), ownerId())); } catch (error) { throw new ToolFailure('COMMAND_EXECUTION_FAILED', safeError(error)); } } };
}
function writeTool(registry: ExecutionProcessRegistry, ownerId: () => string): Tool {
  return { definition: { name: 'exec_write', description: '向活跃进程的 stdin 写入有限文本。', parameters: { type: 'object', properties: { processId: { type: 'string' }, text: { type: 'string' } }, required: ['processId', 'text'], additionalProperties: false } }, permission: { kind: 'process-interact' },
    execute: async args => { const value = parseObject(args); try { registry.write(string(value.processId), string(value.text), ownerId()); return '输入已写入进程。'; } catch (error) { throw new ToolFailure('COMMAND_EXECUTION_FAILED', safeError(error)); } } };
}
function cancelTool(registry: ExecutionProcessRegistry, ownerId: () => string): Tool {
  return { definition: { name: 'exec_cancel', description: '协作终止进程及其子进程。', parameters: { type: 'object', properties: { processId: { type: 'string' } }, required: ['processId'], additionalProperties: false } }, permission: { kind: 'process-interact' },
    execute: async args => { const value = parseObject(args); try { const status = registry.status(string(value.processId), ownerId()); return JSON.stringify(status ? { processId: status.processId, state: (await registry.cancel(string(value.processId), ownerId())).state } : { error: 'PROCESS_NOT_FOUND' }); } catch (error) { throw new ToolFailure('COMMAND_EXECUTION_FAILED', safeError(error)); } } };
}
function statusTool(registry: ExecutionProcessRegistry, workspaceRoot: string, ownerId: () => string): Tool {
  return { definition: { name: 'exec_status', description: '查看进程运行、退出或取消状态。', parameters: { type: 'object', properties: { processId: { type: 'string' } }, required: ['processId'], additionalProperties: false } },
    execute: async args => { const value = parseObject(args); const status = registry.status(string(value.processId), ownerId()); return status ? JSON.stringify(publicStatus(status, workspaceRoot)) : JSON.stringify({ error: 'PROCESS_NOT_FOUND' }); } };
}
function publicStatus(status: ManagedProcessStatus, workspaceRoot: string): object { return { processId: status.processId, state: status.state, adapter: status.adapter, tty: status.tty, elapsedMs: status.elapsedMs, outputBytes: status.outputBytes, workdir: workspaceRoot ? relative(workspaceRoot, status.workdir) || '.' : status.workdir, startedAt: status.startedAt, ...(status.endedAt ? { endedAt: status.endedAt } : {}), ...(status.exitCode !== undefined ? { exitCode: status.exitCode } : {}), ...(status.signal !== undefined ? { signal: status.signal } : {}), ...(status.errorCode ? { errorCode: status.errorCode } : {}), outputCursor: status.outputCursor }; }
function parse(source: string): { executable: string; argv: string[]; workdir?: string; timeoutMs?: number; tty?: boolean; adapter?: 'local' | 'managed-toolchain' | 'container'; dependencyId?: string; executableId?: string } { const value = parseObject(source); if (typeof value.executable !== 'string' || !value.executable.trim() || !Array.isArray(value.argv) || value.argv.some(item => typeof item !== 'string')) throw invalidArguments('exec_start executable and argv are required'); if (value.workdir !== undefined && typeof value.workdir !== 'string') throw invalidArguments('exec_start workdir must be a string'); if (value.timeoutMs !== undefined && (typeof value.timeoutMs !== 'number' || !Number.isFinite(value.timeoutMs) || value.timeoutMs <= 0)) throw invalidArguments('exec_start timeoutMs must be positive'); if (value.tty !== undefined && typeof value.tty !== 'boolean') throw invalidArguments('exec_start tty must be boolean'); if (value.adapter !== undefined && !['local', 'managed-toolchain', 'container'].includes(String(value.adapter))) throw invalidArguments('exec_start adapter is invalid'); if (value.dependencyId !== undefined && typeof value.dependencyId !== 'string' || value.executableId !== undefined && typeof value.executableId !== 'string') throw invalidArguments('exec_start toolchain identifiers must be strings'); return { executable: value.executable, argv: value.argv as string[], ...(typeof value.workdir === 'string' ? { workdir: value.workdir } : {}), ...(typeof value.timeoutMs === 'number' ? { timeoutMs: value.timeoutMs } : {}), ...(typeof value.tty === 'boolean' ? { tty: value.tty } : {}), ...(typeof value.adapter === 'string' ? { adapter: value.adapter as 'local' | 'managed-toolchain' | 'container' } : {}), ...(typeof value.dependencyId === 'string' ? { dependencyId: value.dependencyId } : {}), ...(typeof value.executableId === 'string' ? { executableId: value.executableId } : {}) }; }
function parseObject(source: string): Record<string, unknown> { try { const value: unknown = JSON.parse(source); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; } catch { throw invalidArguments('tool arguments must be a JSON object'); } }
function string(value: unknown): string { if (typeof value !== 'string' || !value.trim()) throw invalidArguments('string argument is required'); return value; }
function integer(value: unknown, fallback: number): number { if (value === undefined) return fallback; if (!Number.isInteger(value) || (value as number) < 0) throw invalidArguments('integer argument is invalid'); return value as number; }
function safeError(error: unknown): string { const message = error instanceof Error ? error.message : 'EXECUTION_FAILED'; return /^[A-Z0-9_]{3,64}$/u.test(message) ? message : 'EXECUTION_FAILED'; }

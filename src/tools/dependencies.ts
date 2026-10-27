import type { DependencyManager } from '../dependencies/manager.js';
import { ToolFailure, invalidArguments } from './errors.js';
import type { Tool, ToolCapability } from './types.js';

export function createDependencyCapability(manager: DependencyManager): ToolCapability {
  return {
    id: 'managed-dependencies',
    instructions: '先用 dependency_catalog 查看当前平台已验证的固定依赖。安装时只传清单中的 dependency ID 和可选版本；Isla 会分别请求依赖安装与精确下载主机批准。安装后使用 exec_start 的 managed-toolchain 执行器和清单中的 executableId。不要构造 URL、安装路径或安装脚本。',
    tools: [catalogTool(manager), installedTool(manager), installTool(manager), uninstallTool(manager)],
  };
}

function catalogTool(manager: DependencyManager): Tool {
  return { definition: { name: 'dependency_catalog', description: '列出本平台由 Isla 固定校验的受管依赖清单，不含下载 URL。', parameters: { type: 'object', properties: {}, additionalProperties: false } }, execute: async () => JSON.stringify(manager.available()) };
}

function installedTool(manager: DependencyManager): Tool {
  return { definition: { name: 'dependency_list', description: '列出已安装受管依赖的安全摘要。', parameters: { type: 'object', properties: {}, additionalProperties: false } }, execute: async () => JSON.stringify((await manager.list()).map(item => ({ id: item.id, version: item.version, platform: item.platform, arch: item.arch, executableIds: Object.keys(item.executables), license: item.license, installedAt: item.installedAt }))) };
}

function installTool(manager: DependencyManager): Tool {
  return {
    definition: { name: 'dependency_install', description: '安装固定 Manifest 中的受管依赖；只允许 ID 和版本约束，不接受 URL 或路径。', parameters: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{0,63}$' }, version: { type: 'string' } }, required: ['id'], additionalProperties: false } },
    permission: [{ kind: 'dependency-install' }, { kind: 'network-download' }],
    describe: argumentsJson => { const value = parse(argumentsJson); return `安装固定受管依赖 ${value.id}${value.version ? `（版本 ${value.version}）` : ''}`; },
    policyContext: argumentsJson => { const value = parse(argumentsJson); return { networkHost: manager.sourceHost(value.id, value.version) }; },
    execute: async (argumentsJson, options) => {
      const value = parse(argumentsJson);
      try {
        const installed = await manager.install(value.id, value.version, options?.signal);
        return JSON.stringify({ id: installed.id, version: installed.version, platform: installed.platform, arch: installed.arch, executableIds: Object.keys(installed.executables), license: installed.license, sha256: installed.sha256 });
      } catch (error) { throw new ToolFailure('COMMAND_EXECUTION_FAILED', safeError(error)); }
    },
  };
}

function uninstallTool(manager: DependencyManager): Tool {
  return {
    definition: { name: 'dependency_uninstall', description: '卸载 Isla 受管目录中的依赖；不会操作系统目录或用户指定路径。', parameters: { type: 'object', properties: { id: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{0,63}$' }, version: { type: 'string' } }, required: ['id'], additionalProperties: false } },
    permission: { kind: 'dependency-install' },
    describe: argumentsJson => { const value = parse(argumentsJson); return `卸载受管依赖 ${value.id}${value.version ? `（版本 ${value.version}）` : ''}`; },
    execute: async argumentsJson => { const value = parse(argumentsJson); try { return JSON.stringify({ id: value.id, removed: await manager.uninstall(value.id, value.version) }); } catch (error) { throw new ToolFailure('COMMAND_EXECUTION_FAILED', safeError(error)); } },
  };
}

function parse(argumentsJson: string): { readonly id: string; readonly version?: string } {
  let value: unknown;
  try { value = JSON.parse(argumentsJson); } catch { throw invalidArguments('dependency arguments must be valid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidArguments('dependency arguments must be an object');
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(record.id) || (record.version !== undefined && typeof record.version !== 'string')) throw invalidArguments('dependency ID or version is invalid');
  return { id: record.id, ...(typeof record.version === 'string' ? { version: record.version } : {}) };
}

function safeError(error: unknown): string { const message = error instanceof Error ? error.message : 'DEPENDENCY_OPERATION_FAILED'; return /^[A-Z0-9_]{3,64}$/u.test(message) ? message : 'DEPENDENCY_OPERATION_FAILED'; }

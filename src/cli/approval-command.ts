import { randomUUID } from 'node:crypto';
import type { CliCommand } from './command.js';
import { normalizeNetworkHost, type PolicyRuleV1 } from '../approval/policy.js';
import type { ToolPermission } from '../approval/types.js';

const permissions = ['filesystem-read', 'filesystem-write', 'command-execute', 'process-interact', 'network', 'network-download', 'dependency-install', 'mcp-invoke', 'credential-use', 'sandbox-elevate'] as const;
const addRulePattern = new RegExp(`^/approval\\s+add\\s+(${permissions.join('|')})\\s+([A-Za-z0-9_.-]{1,64})\\s+(\\S+)(?:\\s+(\\[.*\\]))?$`, 'u');
export const approvalCommand: CliCommand = {
  name: '/approval', description: '查看、添加或撤销持久权限规则', usage: '/approval list | add <permission> <tool> <workspace-or-host> [argv-json] | revoke <id>', inputMode: 'line',
  async execute(context) {
    if (!context.policyStore) { context.output.write('审批规则存储不可用。\n'); return { type: 'continue' }; }
    const parts = (context.commandLine ?? '/approval').trim().split(/\s+/u);
    const action = parts[1] ?? 'list';
    if (action === 'list' && parts.length === 2) {
      const rules = await context.policyStore.list();
      context.output.write(rules.length ? '持久权限规则：\n' : '当前没有持久权限规则。\n');
      for (const rule of rules) context.output.write(`  ${rule.id} · ${rule.effect} · ${rule.permission ?? '*'} · ${rule.tool ?? '*'} · ${rule.networkHost ? `host=${rule.networkHost}` : rule.workspace ?? '*'}${rule.commandPrefix ? ` · argv 前缀=${JSON.stringify(rule.commandPrefix)}` : ''}${rule.expiresAt ? ` · expires=${rule.expiresAt}` : ''}\n`);
      return { type: 'continue' };
    }
    if (action === 'revoke' && parts.length === 3) {
      context.output.write(await context.policyStore.revoke(parts[2]!) ? `已撤销规则 ${parts[2]}。\n` : `未找到规则 ${parts[2]}。\n`);
      return { type: 'continue' };
    }
    if (action === 'add') {
      const match = (context.commandLine ?? '').match(addRulePattern);
      if (!match) { context.output.write('用法：/approval add <permission> <tool> <workspace-or-host> [argv-json]\n'); return { type: 'continue' }; }
      let commandPrefix: string[] | undefined;
      if (match[4] !== undefined) {
        try { const parsed: unknown = JSON.parse(match[4]); if (!Array.isArray(parsed) || !parsed.length || parsed.some(item => typeof item !== 'string' || !item)) throw new Error(); commandPrefix = parsed; }
        catch { context.output.write('argv-json 必须是非空字符串数组，例如 ["node","--version"]。\n'); return { type: 'continue' }; }
      }
      if (match[1] === 'command-execute' && !commandPrefix) { context.output.write('command-execute 规则必须限定 argv 前缀。\n'); return { type: 'continue' }; }
      if (match[1] !== 'command-execute' && commandPrefix) { context.output.write('argv 前缀仅适用于 command-execute。\n'); return { type: 'continue' }; }
      if (match[1] === 'network' || match[1] === 'network-download') {
        try {
          const networkHost = normalizeNetworkHost(match[3]!);
          const rule: PolicyRuleV1 = { id: `approval-${randomUUID()}`, effect: 'allow', permission: match[1] as ToolPermission['kind'], tool: match[2]!, networkHost };
          await context.policyStore.put(rule);
          context.output.write(`已添加仅适用于 ${networkHost} 的精确网络规则 ${rule.id}。该规则将在下次启动 Isla 后生效。\n`);
        } catch { context.output.write('网络规则必须使用不含协议、路径或端口的精确 hostname。\n'); }
        return { type: 'continue' };
      }
      const rule: PolicyRuleV1 = { id: `approval-${randomUUID()}`, effect: 'allow', permission: match[1] as typeof permissions[number], tool: match[2]!, workspace: match[3]!, ...(commandPrefix ? { commandPrefix } : {}) };
      await context.policyStore.put(rule);
      context.output.write(`已添加精确范围规则 ${rule.id}。该规则将在下次启动 Isla 后生效。\n`);
      return { type: 'continue' };
    }
    context.output.write('用法：/approval list | add <permission> <tool> <workspace> [argv-json] | revoke <id>\n');
    return { type: 'continue' };
  },
};

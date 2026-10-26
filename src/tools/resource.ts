import type { ResourceBridgeClient } from '../resource/bridge-client.js';
import type { CreateResourceJobRequestV1, ResourceJobStatusV1 } from '../resource/contracts.js';
import type { ToolCapability } from './types.js';

export function createResourceCapability(client: ResourceBridgeClient, sessionId: string, turnId: string): ToolCapability {
  const readPermission = { kind: 'filesystem-read' as const };
  const sideEffectPermission = { kind: 'network' as const };
  return {
    id: 'resource',
    instructions: '使用受限 Resource Job Bridge 管理已配置受管目录中的下载与归档任务。只能使用支持的 Job 类型和 managedRootId/relativePath；不要请求或传递密码、分享码、令牌或任意绝对路径。先查 Job 当前状态再采取动作。',
    tools: [
      {
        permission: sideEffectPermission,
        definition: { name: 'resource_job_create', description: '创建一个需要用户审批的受限 Resource 下载或归档任务。只支持 baidu-download 的分享文本/网盘路径和 archive-organizer 的受管相对路径。', parameters: { type: 'object', properties: { tool: { type: 'string', enum: ['baidu-download', 'archive-organizer'] }, inputKind: { type: 'string', enum: ['share-text', 'baidu-path', 'managed-folder', 'managed-file'] }, text: { type: 'string', maxLength: 20000 }, path: { type: 'string', maxLength: 4096 }, managedRootId: { type: 'string', maxLength: 128 }, relativePath: { type: 'string', maxLength: 4096 }, destinationRootId: { type: 'string', maxLength: 128 } }, required: ['tool', 'inputKind', 'destinationRootId'], additionalProperties: false } },
        async describe(argumentsJson) { const value = parseObject(argumentsJson); return `在受管目录创建 Resource ${safeName(value.tool)} 任务；不会自动启动下载或归档，需在 Resource 中确认预览。`; },
        async execute(argumentsJson, options = {}) { const value = parseObject(argumentsJson); const input = parseCreateArguments(value); const created = await client.create(input, sessionId, turnId, options.toolCallId ?? 'missing-tool-call-id', options.signal); return JSON.stringify({ job: created }); },
      },
      {
        permission: readPermission,
        definition: { name: 'resource_job_get', description: '从 Resource 事实源读取一个 Job 的当前安全状态。', parameters: objectSchema({ jobId: { type: 'string', minLength: 1, maxLength: 128 } }, ['jobId']) },
        async execute(argumentsJson, options = {}) { const value = parseObject(argumentsJson); onlyKeys(value, ['jobId']); return JSON.stringify({ job: await client.get(stringField(value, 'jobId'), options.signal) }); },
      },
      {
        permission: readPermission,
        definition: { name: 'resource_job_list', description: '有界列出 Resource Job 摘要，可按状态过滤。', parameters: objectSchema({ status: { type: 'string', enum: ['queued', 'running', 'waiting_user', 'cancelling', 'completed', 'failed', 'cancelled'] }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, []) },
        async execute(argumentsJson, options = {}) { const value = parseObject(argumentsJson); onlyKeys(value, ['status', 'limit']); const status = value.status === undefined ? undefined : jobStatus(value.status); const limit = value.limit === undefined ? 20 : integerField(value, 'limit', 1, 50); return JSON.stringify({ jobs: await client.list(status, limit, options.signal) }); },
      },
      {
        permission: sideEffectPermission,
        definition: { name: 'resource_job_cancel', description: '按已读取 revision 请求取消一个 Resource Job；重复或终态取消不改变 Job。', parameters: objectSchema({ jobId: { type: 'string', minLength: 1, maxLength: 128 }, revision: { type: 'integer', minimum: 1 } }, ['jobId', 'revision']) },
        async execute(argumentsJson, options = {}) { const value = parseObject(argumentsJson); onlyKeys(value, ['jobId', 'revision']); const result = await client.cancel(stringField(value, 'jobId'), integerField(value, 'revision', 1, Number.MAX_SAFE_INTEGER), options.signal); return JSON.stringify(result); },
      },
      {
        permission: sideEffectPermission,
        definition: { name: 'resource_job_respond', description: '响应 waiting_user 的非秘密决定。密码或分享码必须由 Resource UI 的秘密输入流程提交，禁止在此 Tool 参数中传递。', parameters: objectSchema({ jobId: { type: 'string', minLength: 1, maxLength: 128 }, revision: { type: 'integer', minimum: 1 }, decisionId: { type: 'string', minLength: 1, maxLength: 128 }, action: { type: 'string', enum: ['approve', 'reject', 'replace_input', 'choose_destination'] }, text: { type: 'string', maxLength: 20000 }, destinationRootId: { type: 'string', maxLength: 128 } }, ['jobId', 'revision', 'decisionId', 'action']) },
        async execute(argumentsJson, options = {}) { const value = parseObject(argumentsJson); onlyKeys(value, ['jobId', 'revision', 'decisionId', 'action', 'text', 'destinationRootId']); const action = value.action; if (action !== 'approve' && action !== 'reject' && action !== 'replace_input' && action !== 'choose_destination') throw new Error('RESOURCE_ACTION_INVALID'); const values = action === 'replace_input' ? { text: safeReplacement(stringField(value, 'text')) } : action === 'choose_destination' ? { destinationRootId: stringField(value, 'destinationRootId') } : undefined; return JSON.stringify(await client.respond(stringField(value, 'jobId'), { revision: integerField(value, 'revision', 1, Number.MAX_SAFE_INTEGER), decisionId: stringField(value, 'decisionId'), action, ...(values ? { values } : {}) }, options.signal)); },
      },
      {
        permission: readPermission,
        definition: { name: 'resource_artifact_get', description: '按 Job 和 Artifact ID 读取安全 Artifact 元数据；不读取文件正文。', parameters: objectSchema({ jobId: { type: 'string', minLength: 1, maxLength: 128 }, artifactId: { type: 'string', minLength: 1, maxLength: 128 } }, ['jobId', 'artifactId']) },
        async execute(argumentsJson, options = {}) { const value = parseObject(argumentsJson); onlyKeys(value, ['jobId', 'artifactId']); return JSON.stringify({ artifact: await client.artifact(stringField(value, 'jobId'), stringField(value, 'artifactId'), options.signal) }); },
      },
    ],
  };
}

function parseCreateArguments(value: Record<string, unknown>): CreateResourceJobRequestV1 {
  onlyKeys(value, ['tool', 'inputKind', 'text', 'path', 'managedRootId', 'relativePath', 'destinationRootId']);
  const tool = value.tool; const kind = value.inputKind; const destinationRootId = stringField(value, 'destinationRootId');
  if (tool === 'baidu-download' && kind === 'share-text') { const text = boundedString(value, 'text', 20_000); safeReplacement(text); return { tool, input: { kind, text }, destinationRootId, startMode: 'after-preview' }; }
  if (tool === 'baidu-download' && kind === 'baidu-path') { const path = boundedString(value, 'path', 4096); if (!path.startsWith('/') || path.includes('..')) throw new Error('RESOURCE_PATH_INVALID'); return { tool, input: { kind, path }, destinationRootId, startMode: 'after-preview' }; }
  if (tool === 'archive-organizer' && (kind === 'managed-folder' || kind === 'managed-file')) { const relativePath = boundedString(value, 'relativePath', 4096); if (relativePath.includes('..') || /^[\\/]/u.test(relativePath) || /^[A-Za-z]:/u.test(relativePath)) throw new Error('RESOURCE_PATH_INVALID'); return { tool, input: { kind, managedRootId: stringField(value, 'managedRootId'), relativePath }, destinationRootId, startMode: 'after-preview' }; }
  throw new Error('RESOURCE_INPUT_INVALID');
}
function parseObject(source: string): Record<string, unknown> { let value: unknown; try { value = JSON.parse(source); } catch { throw new Error('INVALID_TOOL_ARGUMENTS'); } if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_TOOL_ARGUMENTS'); return value as Record<string, unknown>; }
function stringField(value: Record<string, unknown>, name: string): string { const item = value[name]; if (typeof item !== 'string' || !item.trim() || item.length > 4096) throw new Error('RESOURCE_ARGUMENT_INVALID'); return item; }
function boundedString(value: Record<string, unknown>, name: string, max: number): string { const item = value[name]; if (typeof item !== 'string' || !item.trim() || item.length > max) throw new Error('RESOURCE_ARGUMENT_INVALID'); return item; }
function integerField(value: Record<string, unknown>, name: string, min: number, max: number): number { const item = value[name]; if (!Number.isSafeInteger(item) || (item as number) < min || (item as number) > max) throw new Error('RESOURCE_ARGUMENT_INVALID'); return item as number; }
function jobStatus(value: unknown): ResourceJobStatusV1 { if (typeof value !== 'string' || !['queued', 'running', 'waiting_user', 'cancelling', 'completed', 'failed', 'cancelled'].includes(value)) throw new Error('RESOURCE_STATUS_INVALID'); return value as ResourceJobStatusV1; }
function safeName(value: unknown): string { return value === 'baidu-download' || value === 'archive-organizer' ? value : 'job'; }
function safeReplacement(value: string): string { if (/(?:提取码|分享码|密码|password|share.?code)\s*[:：=]|[?&](?:pwd|pass(?:word)?|code|token)=/iu.test(value)) throw new Error('RESOURCE_SECRET_INPUT_REQUIRES_UI'); return value; }
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): void { if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('RESOURCE_ARGUMENT_INVALID'); }
function objectSchema(properties: Record<string, unknown>, required: readonly string[]): Record<string, unknown> { return { type: 'object', properties, required, additionalProperties: false }; }

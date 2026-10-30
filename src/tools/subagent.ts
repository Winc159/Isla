import type { JobRuntime } from '../jobs/runtime.js';
import type { ToolCapability } from './types.js';

export function createSubagentCapability(options: { readonly jobs: JobRuntime; readonly parentAgentId: string; readonly parentSessionId: string; readonly workspaceRoot: string; readonly canCreate: () => boolean }): ToolCapability {
  return {
    id: 'builtin.subagent',
    instructions: '可将一个明确、只读的研究子问题委托给一层 Subagent。子 Agent 不可写文件、执行命令、创建孙 Agent 或与用户交互。读取 Job 结果后由主 Agent 独立核对并负责最终结论。',
    tools: [
      {
        definition: { name: 'subagent_create', description: '创建一个受限只读研究 Subagent Job。', parameters: { type: 'object', properties: { objective: { type: 'string', minLength: 8, maxLength: 2000 } }, required: ['objective'], additionalProperties: false } },
        async execute(raw, execution = {}) {
          if (!options.canCreate()) throw new Error('SUBAGENT_DEPTH_EXCEEDED');
          const outstanding = options.jobs.list({ ownerId: options.parentSessionId, limit: 100 }).filter(job => job.type === 'subagent' && ['queued','running','waiting_user'].includes(job.status)).length;
          if (outstanding >= 2) throw new Error('SUBAGENT_CONCURRENCY_LIMIT');
          const value = parseArgs(raw); const objective = value.objective;
          if (typeof objective !== 'string' || objective.trim().length < 8 || objective.length > 2000) throw new Error('SUBAGENT_OBJECTIVE_INVALID');
          const job = options.jobs.create({ type: 'subagent', owner: { kind: 'session', id: options.parentSessionId }, ...(execution.toolCallId ? { idempotencyKey: execution.toolCallId } : {}), inputRef: `subagent:${options.parentAgentId}`, payload: { parentAgentId: options.parentAgentId, parentSessionId: options.parentSessionId, workspaceRoot: options.workspaceRoot, objective: objective.trim() }, maxAttempts: 3 });
          return JSON.stringify({ jobId: job.id, status: job.status, objective: objective.trim() });
        },
      },
      {
        definition: { name: 'subagent_wait', description: '等待 Subagent Job 完成或返回其当前状态。', parameters: { type: 'object', properties: { jobId: { type: 'string', minLength: 36, maxLength: 36 }, timeoutMs: { type: 'integer', minimum: 1000, maximum: 120000 } }, required: ['jobId'], additionalProperties: false } },
        async execute(raw, execution = {}) {
          const value = parseArgs(raw); const id = requiredString(value.jobId); const timeout = integer(value.timeoutMs, 120_000);
          const job = options.jobs.get(id);
          if (!job || job.type !== 'subagent' || job.owner.id !== options.parentSessionId) throw new Error('SUBAGENT_JOB_NOT_FOUND');
          const end = Date.now() + timeout;
          while (Date.now() < end) {
            if (execution.signal?.aborted) throw new Error('TURN_CANCELLED');
            const current = options.jobs.get(id); if (!current) throw new Error('SUBAGENT_JOB_NOT_FOUND');
            if (['completed','failed','cancelled'].includes(current.status)) return JSON.stringify({ job: current });
            await delay(250, execution.signal);
          }
          return JSON.stringify({ job: options.jobs.get(id), timedOut: true });
        },
      },
      {
        definition: { name: 'subagent_cancel', description: '取消此父 Session 创建的 Subagent Job。', parameters: { type: 'object', properties: { jobId: { type: 'string', minLength: 36, maxLength: 36 } }, required: ['jobId'], additionalProperties: false } },
        async execute(raw) {
          const value = parseArgs(raw); const id = requiredString(value.jobId); const job = options.jobs.get(id);
          if (!job || job.type !== 'subagent' || job.owner.id !== options.parentSessionId) throw new Error('SUBAGENT_JOB_NOT_FOUND');
          return JSON.stringify(options.jobs.cancel(id));
        },
      },
    ],
  };
}
function parseArgs(raw: string): Record<string, unknown> { try { const value: unknown = JSON.parse(raw); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; } catch { throw new Error('SUBAGENT_ARGUMENTS_INVALID'); } }
function requiredString(value: unknown): string { if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/iu.test(value)) throw new Error('SUBAGENT_JOB_ID_INVALID'); return value; }
function integer(value: unknown, fallback: number): number { if (value === undefined) return fallback; if (!Number.isSafeInteger(value) || (value as number) < 1000 || (value as number) > 120000) throw new Error('SUBAGENT_TIMEOUT_INVALID'); return value as number; }
function delay(ms: number, signal?: AbortSignal): Promise<void> { return new Promise((resolve, reject) => { const timer = setTimeout(resolve, ms); const abort = () => { clearTimeout(timer); reject(new Error('TURN_CANCELLED')); }; signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort(); }); }

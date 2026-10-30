import type { CliCommand } from './command.js';
import { loadOrCreateLocalRuntimeConfig } from '../config/local-runtime.js';
import { ResidentHostClient } from '../client/host-client.js';

export const jobsCommand: CliCommand = {
  name: '/jobs', description: '查看 Host 管理的持久 Job', inputMode: 'line',
  async execute(context) {
    const runtime = await loadOrCreateLocalRuntimeConfig();
    const client = new ResidentHostClient(`http://${runtime.host.host}:${runtime.host.port}`, runtime.host.token);
    const result = await client.jobs() as { jobs?: readonly { id: string; type: string; status: string; attempt: number; updatedAt: string; progress?: { message?: string; current?: number; total?: number } }[] };
    if (!result.jobs?.length) context.output.write('当前没有通用持久 Job。Resource Job 仍由 Resource 服务独立管理。\n');
    else for (const job of result.jobs) context.output.write(`${job.id}  ${job.type}  ${job.status}  attempt=${job.attempt}  ${job.progress?.message ?? ''}\n`);
    return { type: 'continue' };
  },
};

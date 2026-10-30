import type { SafeResourceJob } from '../resource/bridge-client.js';

export interface UnifiedResourceJobViewV1 {
  readonly kind: 'resource'; readonly id: string; readonly type: 'resource'; readonly status: string; readonly stage: string;
  readonly progress: { readonly ratio?: number; readonly completedBytes?: number; readonly totalBytes?: number };
  readonly artifacts: readonly { readonly id: string; readonly label: string; readonly status: string; readonly relativePath?: string }[];
  readonly waitingUser?: { readonly type: string; readonly actions: readonly string[] };
  readonly errorCode?: string; readonly createdAt: string; readonly updatedAt: string;
}

/** Read-only presentation adapter. Resource remains the only writer and status authority. */
export function projectResourceJob(job: SafeResourceJob): UnifiedResourceJobViewV1 {
  return { kind: 'resource', id: job.id, type: 'resource', status: job.status, stage: job.stage, progress: job.progress,
    artifacts: job.artifacts.map(item => ({ id: item.id, label: item.kind, status: item.status, ...(item.path ? { relativePath: item.path } : {}) })),
    ...(job.pendingDecision ? { waitingUser: { type: job.pendingDecision.type, actions: job.pendingDecision.actions } } : {}),
    ...(job.failure ? { errorCode: job.failure.code } : {}), createdAt: job.createdAt, updatedAt: job.updatedAt };
}

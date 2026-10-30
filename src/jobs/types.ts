export const JOB_STATUSES = ['queued', 'running', 'waiting_user', 'completed', 'failed', 'cancelled'] as const;
export type JobStatus = typeof JOB_STATUSES[number];

export interface JobV1 {
  readonly version: 1;
  readonly id: string;
  readonly type: string;
  readonly owner: { readonly kind: 'session' | 'job'; readonly id: string };
  readonly idempotencyKey?: string;
  readonly inputRef: string;
  readonly status: JobStatus;
  readonly progress?: { readonly current?: number; readonly total?: number; readonly message?: string };
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly waitingUser?: { readonly prompt: string; readonly since: string };
  readonly artifacts: readonly { readonly id: string; readonly mediaType: string; readonly label: string }[];
  readonly result?: unknown;
  readonly errorCode?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface JobLeaseV1 {
  readonly jobId: string;
  readonly ownerId: string;
  readonly expiresAt: string;
  readonly heartbeatAt: string;
}

export interface CreateJobInputV1 {
  readonly type: string;
  readonly owner: JobV1['owner'];
  readonly idempotencyKey?: string;
  readonly inputRef: string;
  readonly payload?: unknown;
  readonly maxAttempts?: number;
}

export interface JobUpdateV1 {
  readonly progress?: JobV1['progress'];
  readonly waitingUser?: JobV1['waitingUser'];
  readonly result?: unknown;
  readonly errorCode?: string;
}

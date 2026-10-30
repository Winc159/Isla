import type { AgentRegistry } from '../core/service-kernel.js';
import type { ChatSession } from '../core/session.js';
import { createSessionFactory } from '../runtime/session-factory.js';
import type { SessionStore } from '../sessions/store.js';
import type { JobRuntime } from './runtime.js';

export interface SubagentJobPayloadV1 {
  readonly parentAgentId: string; readonly parentSessionId: string; readonly workspaceRoot: string; readonly objective: string;
  readonly childSessionId?: string; readonly userAnswer?: string;
}

export function registerSubagentWorker(options: {
  readonly jobs: JobRuntime; readonly sessions: SessionStore; readonly agents: AgentRegistry;
  readonly provider: string; readonly model: string;
  readonly parentFactory: ReturnType<typeof createSessionFactory>;
  readonly createChildFactory: (workspaceRoot: string) => ReturnType<typeof createSessionFactory>;
}): void {
  options.jobs.register('subagent', async ({ job, signal, update }) => {
    const payload = options.jobs.payload(job.id) as SubagentJobPayloadV1 | undefined;
    if (!payload || payload.parentSessionId !== job.owner.id) throw new Error('SUBAGENT_OWNER_INVALID');
    let temporaryParent: ChatSession | undefined;
    let childFactory: ReturnType<typeof createSessionFactory> | undefined;
    let childSession: ChatSession | undefined;
    let abort: (() => void) | undefined;
    try {
      if (!options.agents.get(payload.parentAgentId)) {
        const parentStored = await options.sessions.listAll?.().then(items => items?.find(session => session.id === payload.parentSessionId));
        if (!parentStored) throw new Error('SUBAGENT_PARENT_SESSION_MISSING');
        temporaryParent = options.parentFactory.create({ stored: parentStored, interactive: false, approvalPolicy: 'never', agentId: payload.parentAgentId });
      }
      if (!options.agents.canCreateChild(payload.parentAgentId)) throw new Error('SUBAGENT_OWNER_INVALID');
      let child = payload.childSessionId ? await options.sessions.listAll?.().then(items => items?.find(item => item.id === payload.childSessionId)) : undefined;
      const resumed = Boolean(child);
      if (!child) {
        child = await options.sessions.create(options.provider, options.model, [{ role: 'user', content: payload.objective }], (await import('../sessions/workspace.js')).workspaceKey(payload.workspaceRoot));
        options.jobs.setPayload(job.id, { ...payload, childSessionId: child.id });
      }
      childFactory = options.createChildFactory(payload.workspaceRoot);
      childSession = childFactory.create({ stored: child, interactive: false, approvalPolicy: 'never', jobMode: true, parentAgentId: payload.parentAgentId, jobId: job.id });
      abort = () => childSession?.cancelActiveTurn({ kind: 'shutdown' }); signal.addEventListener('abort', abort, { once: true });
      const nextPrompt = payload.userAnswer ? `用户对待确认问题的答复：${payload.userAnswer}\n\n请依据答复继续，并只报告已核查的结果。` : resumed ? '请根据已有会话进度继续完成子任务，并返回简明 summary、可核查 evidence 和 limitations。' : payload.objective;
      const result = await childSession.send(nextPrompt);
      if (result.outcome === 'needs_user') { update('waiting_user', { waitingUser: { prompt: result.text.slice(0, 2000), since: new Date().toISOString() } }); return { summary: '', evidence: [], artifacts: [], limitations: ['waiting_user'] }; }
      if (result.outcome && result.outcome !== 'completed') throw new Error('SUBAGENT_NOT_COMPLETED');
      return { summary: result.text, evidence: result.evidence ?? [], artifacts: [], limitations: [], ...(result.model ? { model: result.model } : {}) };
    } finally {
      if (abort) signal.removeEventListener('abort', abort);
      if (childSession && childFactory) await childFactory.dispose(childSession);
      if (temporaryParent) await options.parentFactory.dispose(temporaryParent);
    }
  });
}

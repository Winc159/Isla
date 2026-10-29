export type WorkMode = 'plan' | 'act' | 'review';
export type WorkPlanStatus = 'active' | 'blocked' | 'completed';
export type WorkPlanStepKind = 'inspect' | 'change' | 'verify' | 'other';
export interface WorkPlanStep { readonly id: string; readonly title: string; readonly status: 'pending' | 'in_progress' | 'completed' | 'blocked'; readonly dependencies: readonly string[]; readonly kind?: WorkPlanStepKind; readonly evidenceCallIds?: readonly string[]; }
export interface WorkPlanV1 { readonly version: 1; readonly planId: string; readonly revision: number; readonly progressRevision?: number; readonly replanCount?: number; readonly replanReason?: string; readonly goal: string; readonly constraints: readonly string[]; readonly assumptions: readonly string[]; readonly steps: readonly WorkPlanStep[]; readonly risks: readonly string[]; readonly verification: readonly string[]; readonly openQuestions: readonly string[]; readonly status: WorkPlanStatus; readonly approvedRevision?: number; readonly updatedAt: string; }
export interface WorkPlanEvidence { readonly callId: string; readonly success: boolean; readonly executed?: boolean; readonly kind: 'tool' | 'change' | 'verification'; readonly tool?: string; }
export interface WorkModeStateV1 { readonly version: 1; readonly mode: WorkMode; readonly revision: number; readonly actApprovedRevision?: number; readonly updatedAt: string; }
export function validateWorkPlan(value: unknown): WorkPlanV1 {
  if (!value || typeof value !== 'object') throw new Error('PLAN_INVALID');
  const p = value as WorkPlanV1;
  if (p.version !== 1 || typeof p.planId !== 'string' || !p.planId || !Number.isInteger(p.revision) || p.revision < 1 || !text(p.goal) || !Array.isArray(p.steps) || p.steps.length < 1 || p.steps.length > 32 || !['active','blocked','completed'].includes(p.status)) throw new Error('PLAN_INVALID');
  const ids = new Set<string>();
  if (p.progressRevision !== undefined && (!Number.isInteger(p.progressRevision) || p.progressRevision < 0)) throw new Error('PLAN_INVALID');
  if (p.replanCount !== undefined && (!Number.isInteger(p.replanCount) || p.replanCount < 0 || p.replanCount > 2)) throw new Error('PLAN_REPLAN_LIMIT');
  if (p.replanReason !== undefined && !text(p.replanReason)) throw new Error('PLAN_INVALID');
  for (const s of p.steps) { if (!text(s.id) || !text(s.title) || ids.has(s.id) || !['pending','in_progress','completed','blocked'].includes(s.status) || !Array.isArray(s.dependencies) || (s.kind !== undefined && !['inspect','change','verify','other'].includes(s.kind)) || (s.evidenceCallIds !== undefined && (!Array.isArray(s.evidenceCallIds) || s.evidenceCallIds.length > 64 || s.evidenceCallIds.some((id: unknown) => !text(id)) || new Set(s.evidenceCallIds).size !== s.evidenceCallIds.length))) throw new Error('PLAN_INVALID'); ids.add(s.id); }
  for (const s of p.steps) if (s.dependencies.some((id: string) => !ids.has(id) || id === s.id)) throw new Error('PLAN_DEPENDENCY_INVALID');
  for (const step of p.steps) { const seen=new Set<string>(); const visit=(id:string)=>{if(seen.has(id))throw new Error('PLAN_DEPENDENCY_CYCLE');seen.add(id);for(const dep of p.steps.find(s=>s.id===id)?.dependencies??[])visit(dep);seen.delete(id);}; visit(step.id); }
  for (const key of ['constraints','assumptions','risks','verification','openQuestions'] as const) if (!Array.isArray(p[key]) || p[key].length > 32 || p[key].some(x => !text(x))) throw new Error('PLAN_INVALID');
  if (p.approvedRevision !== undefined && p.approvedRevision !== p.revision) throw new Error('PLAN_APPROVAL_STALE');
  if(typeof p.updatedAt!=='string'||!Number.isFinite(Date.parse(p.updatedAt)))throw new Error('PLAN_INVALID');
  return p;
}
export function normalizeWorkPlan(plan: WorkPlanV1): WorkPlanV1 { return validateWorkPlan({ progressRevision: 0, replanCount: 0, ...plan }); }
export function sameWorkPlanStructure(current: WorkPlanV1, next: WorkPlanV1): boolean {
  const shape = (plan: WorkPlanV1) => JSON.stringify({ planId: plan.planId, goal: plan.goal, constraints: plan.constraints, assumptions: plan.assumptions, risks: plan.risks, verification: plan.verification, openQuestions: plan.openQuestions, steps: plan.steps.map(({ id, title, dependencies, kind }) => ({ id, title, dependencies, kind })) });
  return shape(current) === shape(next);
}
export function advanceWorkPlanProgress(current: WorkPlanV1, submitted: WorkPlanV1, evidence: ReadonlyMap<string, WorkPlanEvidence>): WorkPlanV1 {
  const plan = normalizeWorkPlan(submitted);
  if (!sameWorkPlanStructure(current, plan) || plan.revision !== current.revision) throw new Error('PLAN_PROGRESS_STRUCTURE_CHANGED');
  const previous = new Map(current.steps.map(step => [step.id, step]));
  const steps = plan.steps.map(step => {
    const prior = previous.get(step.id)!;
    if (step.status !== prior.status) {
      const allowed = prior.status === 'pending' ? ['in_progress', 'completed', 'blocked'] : prior.status === 'in_progress' ? ['completed', 'blocked'] : [];
      if (!allowed.includes(step.status)) throw new Error('PLAN_PROGRESS_TRANSITION_INVALID');
      if ((step.status === 'in_progress' || step.status === 'completed') && step.dependencies.some(id => previous.get(id)?.status !== 'completed')) throw new Error('PLAN_DEPENDENCY_PENDING');
    }
    const refs = step.evidenceCallIds ?? prior.evidenceCallIds ?? [];
    if (step.status === 'completed' && (refs.length === 0 || refs.some(id => !workPlanEvidenceSatisfiesStep(step, evidence.get(id))))) throw new Error('PLAN_COMPLETION_EVIDENCE_REQUIRED');
    if (step.status === 'completed' && step.kind === 'change' && !refs.some(id => evidence.get(id)?.kind === 'change')) throw new Error('PLAN_CHANGE_EVIDENCE_REQUIRED');
    if (step.status === 'completed' && step.kind === 'verify' && !refs.some(id => evidence.get(id)?.kind === 'verification')) throw new Error('PLAN_VERIFICATION_EVIDENCE_REQUIRED');
    if (step.status === 'blocked' && !refs.some(id => evidence.has(id) && !evidence.get(id)!.success)) throw new Error('PLAN_BLOCKER_EVIDENCE_REQUIRED');
    return { ...step, evidenceCallIds: refs };
  });
  if (plan.status === 'completed' && steps.some(step => step.status !== 'completed')) throw new Error('PLAN_STEPS_INCOMPLETE');
  if (plan.status === 'blocked' && !steps.some(step => step.status === 'blocked')) throw new Error('PLAN_BLOCKER_EVIDENCE_REQUIRED');
  return validateWorkPlan({ ...plan, steps, progressRevision: (current.progressRevision ?? 0) + 1, replanCount: current.replanCount ?? 0, approvedRevision: current.approvedRevision, updatedAt: new Date().toISOString() });
}
export function workPlanEvidenceSatisfiesStep(step: WorkPlanStep, item: WorkPlanEvidence | undefined): boolean {
  if (!item) return false;
  // A failed baseline test is still valid evidence that an inspection ran;
  // only a verify step requires the check itself to pass.
  if (step.kind === 'inspect') return item.executed ?? item.success;
  return item.success;
}
function text(value: unknown): value is string { return typeof value === 'string' && !!value.trim() && value.length <= 1000; }

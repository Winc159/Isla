export type WorkMode = 'plan' | 'act' | 'review';
export type WorkPlanStatus = 'active' | 'blocked' | 'completed';
export interface WorkPlanStep { readonly id: string; readonly title: string; readonly status: 'pending' | 'in_progress' | 'completed' | 'blocked'; readonly dependencies: readonly string[]; }
export interface WorkPlanV1 { readonly version: 1; readonly planId: string; readonly revision: number; readonly goal: string; readonly constraints: readonly string[]; readonly assumptions: readonly string[]; readonly steps: readonly WorkPlanStep[]; readonly risks: readonly string[]; readonly verification: readonly string[]; readonly openQuestions: readonly string[]; readonly status: WorkPlanStatus; readonly approvedRevision?: number; readonly updatedAt: string; }
export interface WorkModeStateV1 { readonly version: 1; readonly mode: WorkMode; readonly revision: number; readonly actApprovedRevision?: number; readonly updatedAt: string; }
export function validateWorkPlan(value: unknown): WorkPlanV1 {
  if (!value || typeof value !== 'object') throw new Error('PLAN_INVALID');
  const p = value as WorkPlanV1;
  if (p.version !== 1 || typeof p.planId !== 'string' || !p.planId || !Number.isInteger(p.revision) || p.revision < 1 || !text(p.goal) || !Array.isArray(p.steps) || p.steps.length < 1 || p.steps.length > 32 || !['active','blocked','completed'].includes(p.status)) throw new Error('PLAN_INVALID');
  const ids = new Set<string>();
  for (const s of p.steps) { if (!text(s.id) || !text(s.title) || ids.has(s.id) || !['pending','in_progress','completed','blocked'].includes(s.status) || !Array.isArray(s.dependencies)) throw new Error('PLAN_INVALID'); ids.add(s.id); }
  for (const s of p.steps) if (s.dependencies.some((id: string) => !ids.has(id) || id === s.id)) throw new Error('PLAN_DEPENDENCY_INVALID');
  for (const step of p.steps) { const seen=new Set<string>(); const visit=(id:string)=>{if(seen.has(id))throw new Error('PLAN_DEPENDENCY_CYCLE');seen.add(id);for(const dep of p.steps.find(s=>s.id===id)?.dependencies??[])visit(dep);seen.delete(id);}; visit(step.id); }
  for (const key of ['constraints','assumptions','risks','verification','openQuestions'] as const) if (!Array.isArray(p[key]) || p[key].length > 32 || p[key].some(x => !text(x))) throw new Error('PLAN_INVALID');
  if (p.approvedRevision !== undefined && p.approvedRevision !== p.revision) throw new Error('PLAN_APPROVAL_STALE');
  if(typeof p.updatedAt!=='string'||!Number.isFinite(Date.parse(p.updatedAt)))throw new Error('PLAN_INVALID');
  return p;
}
function text(value: unknown): value is string { return typeof value === 'string' && !!value.trim() && value.length <= 1000; }

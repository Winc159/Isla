import { describe, expect, it } from 'vitest';
import { advanceWorkPlanProgress, normalizeWorkPlan, validateWorkPlan, type WorkPlanEvidence } from '../../src/core/work-plan.js';

const valid = { version: 1 as const, planId:'p1', revision:1, goal:'Fix module', constraints:[], assumptions:[], steps:[{id:'a',title:'Inspect',status:'pending' as const,dependencies:[]},{id:'b',title:'Fix',status:'pending' as const,dependencies:['a']}], risks:[], verification:['tests'], openQuestions:[], status:'active' as const, updatedAt:new Date(0).toISOString() };
describe('work plan contract', () => {
  it('accepts ordered dependency references', () => expect(validateWorkPlan(valid)).toEqual(valid));
  it('rejects unknown dependencies and stale approvals', () => {
    expect(() => validateWorkPlan({...valid, steps:[{...valid.steps[0]!, dependencies:['missing']}, valid.steps[1]!]})).toThrow('PLAN_DEPENDENCY_INVALID');
    expect(() => validateWorkPlan({...valid, approvedRevision:0})).toThrow('PLAN_APPROVAL_STALE');
  });
  it('updates progress without changing or revoking the approved structural revision', () => {
    const plan = normalizeWorkPlan({...valid, approvedRevision:1, steps:[{...valid.steps[0]!,kind:'inspect' as const},{...valid.steps[1]!,kind:'verify' as const}]});
    const started = advanceWorkPlanProgress(plan,{...plan,steps:[{...plan.steps[0]!,status:'in_progress'},plan.steps[1]!] } as typeof plan,new Map());
    expect(started).toMatchObject({revision:1,progressRevision:1,approvedRevision:1});
    expect(started.steps[0]).toMatchObject({id:'a',status:'in_progress'});
    const completed = advanceWorkPlanProgress(started,{...started,steps:[{...started.steps[0]!,status:'completed',evidenceCallIds:['inspect-call']},started.steps[1]!]},new Map([['inspect-call',{callId:'inspect-call',success:true,kind:'tool'}]]));
    expect(completed).toMatchObject({revision:1,progressRevision:2,approvedRevision:1});
    expect(completed.steps[0]).toMatchObject({id:'a',status:'completed',evidenceCallIds:['inspect-call']});
  });
  it('rejects missing, failed, verification-inappropriate, and out-of-order evidence', () => {
    const plan = normalizeWorkPlan({...valid,steps:[{...valid.steps[0]!,status:'in_progress' as const,kind:'inspect' as const},{...valid.steps[1]!,kind:'verify' as const}]});
    expect(()=>advanceWorkPlanProgress(plan,{...plan,steps:[{...plan.steps[0]!,status:'completed'},plan.steps[1]!] },new Map())).toThrow('PLAN_COMPLETION_EVIDENCE_REQUIRED');
    expect(()=>advanceWorkPlanProgress(plan,{...plan,steps:[{...plan.steps[0]!,status:'completed',evidenceCallIds:['bad']},plan.steps[1]!] },new Map([['bad',{callId:'bad',success:false,kind:'tool'} as WorkPlanEvidence]]))).toThrow('PLAN_COMPLETION_EVIDENCE_REQUIRED');
    expect(()=>advanceWorkPlanProgress(plan,{...plan,steps:[plan.steps[0]!,{...plan.steps[1]!,status:'in_progress'}] },new Map([['ok',{callId:'ok',success:true,kind:'tool'} as WorkPlanEvidence]]))).toThrow('PLAN_DEPENDENCY_PENDING');
    const completed=advanceWorkPlanProgress(plan,{...plan,steps:[{...plan.steps[0]!,status:'completed',evidenceCallIds:['ok']},plan.steps[1]!] },new Map([['ok',{callId:'ok',success:true,kind:'tool'} as WorkPlanEvidence]]));
    const started=advanceWorkPlanProgress(completed,{...completed,steps:[completed.steps[0]!,{...completed.steps[1]!,status:'in_progress'}]},new Map([['ok',{callId:'ok',success:true,kind:'tool'} as WorkPlanEvidence]]));
    expect(()=>advanceWorkPlanProgress(started,{...started,steps:[started.steps[0]!,{...started.steps[1]!,status:'completed',evidenceCallIds:['wrong-kind']}]},new Map([['ok',{callId:'ok',success:true,kind:'tool'} as WorkPlanEvidence],['wrong-kind',{callId:'wrong-kind',success:true,kind:'tool'} as WorkPlanEvidence]]))).toThrow('PLAN_VERIFICATION_EVIDENCE_REQUIRED');
  });
  it('allows a pending step to complete directly when successful evidence and dependencies are present', () => {
    const plan=normalizeWorkPlan({...valid,steps:[{...valid.steps[0]!,kind:'inspect' as const},valid.steps[1]!]});
    const completed=advanceWorkPlanProgress(plan,{...plan,steps:[{...plan.steps[0]!,status:'completed',evidenceCallIds:['read-ok']},plan.steps[1]!] },new Map([['read-ok',{callId:'read-ok',success:true,kind:'tool'} as WorkPlanEvidence]]));
    expect(completed.steps[0]).toMatchObject({status:'completed',evidenceCallIds:['read-ok']});
  });
  it('allows a failed baseline check to complete an inspect step but not a verify step', () => {
    const plan = normalizeWorkPlan({ ...valid, steps:[{ ...valid.steps[0]!, kind:'inspect' as const }, { ...valid.steps[1]!, kind:'verify' as const }] });
    const failedBaseline = { callId:'baseline', success:false, executed:true, kind:'verification' as const, tool:'run_command' };
    const inspected = advanceWorkPlanProgress(plan, { ...plan, steps:[{ ...plan.steps[0]!, status:'completed', evidenceCallIds:['baseline'] }, plan.steps[1]!] }, new Map([['baseline', failedBaseline]]));
    expect(inspected.steps[0]).toMatchObject({ status:'completed', evidenceCallIds:['baseline'] });
    const verifyPlan = normalizeWorkPlan({ ...valid, steps:[{ ...valid.steps[0]!, kind:'inspect' as const, status:'completed' as const, evidenceCallIds:['read'] }, { ...valid.steps[1]!, kind:'verify' as const, status:'in_progress' as const }] });
    expect(() => advanceWorkPlanProgress(verifyPlan, { ...verifyPlan, steps:[verifyPlan.steps[0]!, { ...verifyPlan.steps[1]!, status:'completed', evidenceCallIds:['baseline'] }] }, new Map([['read',{callId:'read',success:true,executed:true,kind:'tool'}],['baseline',failedBaseline]]))).toThrow('PLAN_COMPLETION_EVIDENCE_REQUIRED');
  });
  it('rejects changes to approved structure during an Act progress update', () => {
    const plan=normalizeWorkPlan({...valid,approvedRevision:1});
    expect(()=>advanceWorkPlanProgress(plan,{...plan,goal:'changed'} as typeof plan,new Map())).toThrow('PLAN_PROGRESS_STRUCTURE_CHANGED');
  });
  it('caps persisted replan count at two', () => expect(()=>validateWorkPlan({...valid,replanCount:3})).toThrow('PLAN_REPLAN_LIMIT'));
});

import type { CliCommand } from './command.js';
import { validateWorkPlan } from '../core/work-plan.js';

export const planCommand:CliCommand={name:'/plan',description:'查看工作计划或批准当前计划进入 Act',inputMode:'line',async execute(context){
 const args=(context.commandLine??'/plan').trim().split(/\s+/u);const stored=context.currentSession;const plan='workPlan'in stored?stored.workPlan:undefined;const mode='workMode'in stored?stored.workMode:undefined;
 if(args.length===1){context.output.write(`${JSON.stringify({plan:plan??null,mode:mode?.mode??'plan'},null,2)}\n`);return{type:'continue'};}
 if(args[1]==='approve'){if(!plan){context.output.write('当前没有可批准的工作计划。\n');return{type:'continue'};}validateWorkPlan(plan);const updated=await context.sessionStore.save(stored,{messages:stored.messages,workPlan:{...plan,approvedRevision:plan.revision},workMode:{version:1,mode:'act',revision:(mode?.revision??0)+1,actApprovedRevision:plan.revision,updatedAt:new Date().toISOString()}});context.output.write(`已批准计划 revision ${plan.revision}，切换到 Act。\n`);return{type:'switch-session',session:updated,replayHistory:false};}
 if(args[1]==='mode'&&(args[2]==='plan'||args[2]==='review')){const updated=await context.sessionStore.save(stored,{messages:stored.messages,...(plan?{workPlan:plan}:{}),workMode:{version:1,mode:args[2],revision:(mode?.revision??0)+1,updatedAt:new Date().toISOString()}});context.output.write(`已切换到 ${args[2]} 模式。\n`);return{type:'switch-session',session:updated,replayHistory:false};}
 context.output.write('用法：/plan | /plan approve | /plan mode plan|review\n');return{type:'continue'};
}};

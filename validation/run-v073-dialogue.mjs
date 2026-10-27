import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, mkdir, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/u, '$1').replaceAll('/', '\\');
const fixture = await mkdtemp(join(tmpdir(), 'isla-v073-eval-'));
await mkdir(join(fixture,'src'));
await writeFile(join(fixture,'src','clamp.js'), 'export function clamp(value, min, max) { if (value < min) return min; if (value > max) return value; return value; }\n');
await writeFile(join(fixture,'clamp.test.js'), 'import { test } from "node:test"; import { strict as assert } from "node:assert"; import { clamp } from "./src/clamp.js"; test("clamps below/inside/above bounds",()=>{assert.equal(clamp(-1,0,10),0);assert.equal(clamp(4,0,10),4);assert.equal(clamp(11,0,10),10);});\n');
const sessionDir = join(fixture,'.sessions');
const baseline = await new Promise(resolve=>{const check=spawn(process.execPath,['--test'],{cwd:fixture,stdio:'ignore',windowsHide:true});check.once('close',code=>resolve(code!==0));});
const config = join(process.env.USERPROFILE ?? '', '.isla', 'config.json');
const profile=process.env.ISLA_EVAL_PROFILE??'bailian';
const child = spawn(process.execPath,[join(root,'dist','entrypoints','cli.js'),'--config',config,'--profile',profile,'--protocol','ndjson','--workspace',fixture],{cwd:fixture,env:{...process.env,ISLA_SESSION_DIR:sessionDir},stdio:['pipe','pipe','pipe'],windowsHide:true});
const lines=createInterface({input:child.stdout});let stage='ready';let serial=0;let plan;let explicitPlanApproval=false;let modeAct=false;let writeOk=false;let testOk=false;let reviewDone=false;let failure;const tools=[];
const send=(request)=>child.stdin.write(`${JSON.stringify({id:`v073-${++serial}`,...request})}\n`);
const safe=(s)=>s.replace(/(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+)/giu,'<redacted>').slice(0,1000);
const timer=setTimeout(()=>{failure='dialogue_timeout';child.kill();},240000);
lines.on('line',line=>{let event;try{event=JSON.parse(line);}catch{failure='invalid_protocol_json';child.kill();return;}
 if(event.type==='ready'&&stage==='ready'){stage='planning';send({type:'prompt',text:'请检查当前目录中的 clamp 模块和测试。先不要改文件或运行会改变文件的命令；用 update_work_plan 提交一个完整计划，goal、steps、dependencies、risks、verification、openQuestions 都要真实反映这个修复。计划后停止等待用户批准。'});}
 if(event.type==='tool_start')tools.push(event.tool);
 if(event.type==='approval_request')send({type:'approval_response',approvalId:event.approvalId,approved:true});
 if(event.type==='tool_end'&&event.tool==='edit_text_file'||event.type==='tool_end'&&event.tool==='write_text_file')writeOk ||= event.ok===true;
 if(event.type==='tool_end'&&event.tool==='run_command')testOk ||= event.ok===true;
 if(event.type==='response_end'&&(stage==='planning'||stage==='plan-retry')){stage='get-plan';send({type:'plan_get'});}
 else if(event.type==='plan_state'&&stage==='get-plan'){plan=event.plan;if(!plan){if(!failure){stage='plan-retry';send({type:'prompt',text:'你刚才只给了文字方案，没有持久化 Plan。请现在严格调用 update_work_plan 工具提交完整、有效的 plan（含 steps、dependencies、risks、verification、openQuestions），不要调用其他工具，不要修改文件。'});failure='model_did_not_create_plan_after_retry';}else child.kill();return;}failure=undefined;stage='approved';send({type:'mode_set',mode:'act',approvePlanRevision:plan.revision});}
 else if(event.type==='plan_state'&&stage==='approved'){plan=event.plan;explicitPlanApproval=Boolean(plan&&plan.approvedRevision===plan.revision&&event.mode?.actApprovedRevision===plan.revision);modeAct=event.mode?.mode==='act';stage='acting';send({type:'prompt',text:'按当前已批准的计划修复 src/clamp.js 中的边界错误。先读测试并理解失败点，最小修改，然后运行 node --test 验证；报告实际结果。'});}
 else if(event.type==='response_end'&&stage==='acting'){stage='review-mode';send({type:'mode_set',mode:'review'});}
 else if(event.type==='plan_state'&&stage==='review-mode'){stage='review';send({type:'prompt',text:'现在处于 Review 模式。只运行 node --test 并审阅工作区差异；不要修改任何文件。按实际结果报告是否通过。'});}
 else if(event.type==='response_end'&&stage==='review'){reviewDone=true;stage='done';send({type:'exit'});}
 else if(event.type==='error'){failure=`${event.code??'error'}:${safe(event.message??'')}`;child.kill();}
});
child.stderr.on('data',chunk=>{for(const line of String(chunk).split(/\r?\n/u))if(line.trim())process.stderr.write(`${safe(line)}\n`);});
try{
 const exitCode=await new Promise(resolve=>child.once('close',resolve));clearTimeout(timer);
 const checkpointDir=join(fixture,'.isla-local','checkpoints');let checkpointCount=0;try{checkpointCount=(await readdir(checkpointDir)).filter(name=>name.endsWith('.json')).length;}catch{}
 const checks={baselineHasBug:baseline,planCreated:Boolean(plan?.planId&&plan?.steps?.length),planApproved:Boolean(plan&&plan.approvedRevision===plan.revision),explicitApproval:explicitPlanApproval,actModeReached:modeAct,writeToolSucceeded:writeOk,verificationToolSucceeded:testOk,reviewCompleted:reviewDone,checkpointCreated:checkpointCount>0,noSecretOutput:true};
 const score=Object.values(checks).filter(Boolean).length*100/10;
 process.stdout.write(JSON.stringify({score,pass:score>=90&&!failure&&exitCode===0&&checks.planCreated&&checks.planApproved&&checks.explicitApproval&&checks.writeToolSucceeded&&checks.verificationToolSucceeded&&checks.reviewCompleted&&checks.checkpointCreated,checks,tools:[...new Set(tools)],failure,exitCode,planRevision:plan?.revision})+'\n');
 if(score<90||failure||exitCode!==0)process.exitCode=1;
}finally{clearTimeout(timer);await rm(fixture,{recursive:true,force:true});}

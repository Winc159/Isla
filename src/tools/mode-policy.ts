import { classifyTool } from './catalog.js';
import type { WorkMode } from '../core/work-plan.js';

export function toolAllowedInMode(name:string,mode:WorkMode):boolean {
  if(mode==='act')return true;
  const boundary=classifyTool(name).boundary;
  if(mode==='plan')return boundary==='read'||name==='web_search'||name==='web_fetch'||['update_work_plan','update_task_state','submit_result','report_blocked','capability_search','capability_activate','capability_status','tool_catalog','ask_user_question'].includes(name);
  return boundary==='read'||name==='run_command'||['submit_result','report_blocked','ask_user_question'].includes(name);
}
export function reviewCommandIsVerification(argumentsJson:string):boolean { try{return JSON.parse(argumentsJson).purpose==='verification';}catch{return false;} }

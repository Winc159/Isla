import type { ToolExecutionResult } from '../tools/types.js';

export type ProgressKind = 'evidence' | 'mutation' | 'verification' | 'task_update' | 'observation' | 'failure';
export interface ProgressEvaluation { readonly changed: boolean; readonly kind: ProgressKind; readonly reason: string; }

export function evaluateToolProgress(tool: string, result: ToolExecutionResult): ProgressEvaluation {
  if (!result.ok) return { changed: false, kind: 'failure', reason: result.code };
  if (tool === 'write_text_file' || tool === 'edit_text_file') return { changed: true, kind: 'mutation', reason: 'workspace_mutation' };
  if (result.details?.type === 'task_state_update') return { changed: result.details.changed !== false, kind: 'task_update', reason: result.details.changed === false ? 'task_state_unchanged' : 'task_state_update' };
  if (result.details?.type === 'work_plan_progress') return { changed: true, kind: 'task_update', reason: 'work_plan_progress_updated' };
  if (result.details?.type === 'command_execution' && result.details.purpose === 'verification') return { changed: result.details.exitCode === 0 && !result.details.timedOut && !result.details.aborted, kind: 'verification', reason: result.details.exitCode === 0 ? 'verification_passed' : 'verification_failed' };
  if (result.details?.type === 'project_search') return { changed: result.details.sources.length > 0, kind: 'evidence', reason: result.details.sources.length > 0 ? 'project_sources_found' : 'no_project_sources' };
  if (result.details?.type === 'web_search') return { changed: result.details.sources.length > 0, kind: 'evidence', reason: result.details.sources.length > 0 ? 'web_sources_found' : 'no_web_sources' };
  if (result.details?.type === 'web_fetch') return { changed: result.details.statusCode >= 200 && result.details.statusCode < 300, kind: 'evidence', reason: `web_fetch_${result.details.statusCode}` };
  if (tool === 'subagent_wait' && /"status":"completed"/u.test(result.content)) return { changed: true, kind: 'evidence', reason: 'subagent_job_completed' };
  return { changed: false, kind: 'observation', reason: `${tool}_observation` };
}

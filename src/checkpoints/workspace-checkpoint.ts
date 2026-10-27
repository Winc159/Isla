import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, rm, lstat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface WorkspaceCheckpointV1 { readonly version:1; readonly id:string; readonly createdAt:string; readonly workspace:string; readonly gitHead?:string; readonly gitIndexSummary?:string; readonly gitWorktreeSummary?:string; readonly excludedPaths:readonly string[]; readonly files:Readonly<Record<string,string>>; }
export interface WorkspaceCheckpointPreview { readonly id:string; readonly restore:readonly string[]; readonly remove:readonly string[]; readonly diffs:readonly {readonly path:string;readonly action:'restore'|'remove';readonly diff?:string;readonly omittedReason?:string}[];readonly truncatedFiles:number; }
const SKIP = new Set(['.git','node_modules','.isla-local','dist','coverage','resource']);
const SECRET_PATH = /(^|\/)(\.env(?:\..*)?|[^/]*(?:secret|credential|token|private[-_]?key)[^/]*|[^/]+\.(?:pem|key|p12|pfx))$/iu;
const SECRET_CONTENT = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:api[_-]?key|access[_-]?token|secret)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{20,}/iu;
const MAX_DIFF_FILES = 100;
const MAX_DIFF_TOTAL_CHARS = 24_000;
const MAX_FILE_DIFF_CHARS = 8_000;

export class WorkspaceCheckpointStore {
  private readonly root: string;
  private readonly directory: string;
  constructor(workspace: string) { this.root = resolve(workspace); this.directory = join(this.root,'.isla-local','checkpoints'); }
  async create(): Promise<WorkspaceCheckpointV1> {
    const files: Record<string,string> = {}; const excludedPaths:string[]=[];
    for (const path of await workspaceFiles(this.root)) {
      const rel = relative(this.root,path).split(sep).join('/');
      if (SECRET_PATH.test(rel)) { excludedPaths.push(rel); continue; }
      try { const data = await readFile(path); if (data.byteLength > 1_000_000 || data.includes(0)) { excludedPaths.push(rel); continue; } const content=data.toString('utf8'); if (SECRET_CONTENT.test(content)) { excludedPaths.push(rel); continue; } files[rel]=content; } catch { excludedPaths.push(rel); }
    }
    const git = await gitSummaryAt(this.root);
    const value: WorkspaceCheckpointV1 = { version:1,id:randomUUID(),createdAt:new Date().toISOString(),workspace:this.root,...git,excludedPaths,files };
    await mkdir(this.directory,{recursive:true});
    const snapshot=JSON.stringify(value);
    await writeFile(join(this.directory,`${value.id}.json`),snapshot,'utf8');
    return value;
  }
  async list(): Promise<readonly Pick<WorkspaceCheckpointV1,'id'|'createdAt'|'gitHead'>[]> {
    await mkdir(this.directory,{recursive:true}); const result=[] as {id:string;createdAt:string;gitHead?:string}[];
    for(const name of await readdir(this.directory)) if(name.endsWith('.json')) try { const value=JSON.parse(await readFile(join(this.directory,name),'utf8')) as WorkspaceCheckpointV1; result.push({id:value.id,createdAt:value.createdAt,...(value.gitHead?{gitHead:value.gitHead}:{})}); } catch { /* ignore invalid local record */ }
    return result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  async preview(id:string): Promise<WorkspaceCheckpointPreview> {
    const value=await this.load(id); const current=new Set(await workspaceFiles(this.root)); const target=new Set(Object.keys(value.files).map(path=>resolve(this.root,path)));
    const restore:string[]=[]; const diffs:{path:string;action:'restore'|'remove';diff?:string;omittedReason?:string}[]=[]; let totalDiffChars=0; let truncatedFiles=0;
    for(const path of target){const rel=relative(this.root,path).split(sep).join('/');await assertSafePath(this.root,path);let before='';let exists=true;try{const data=await readFile(path);if(data.byteLength>1_000_000||data.includes(0)){restore.push(rel);diffs.push({path:rel,action:'restore',omittedReason:data.byteLength>1_000_000?'oversized':'binary'});continue;}before=data.toString('utf8');}catch{exists=false;}
      const after=value.files[rel]!;if(exists&&before===after)continue;restore.push(rel);let entry:{path:string;action:'restore';diff?:string;omittedReason?:string};
      if(SECRET_CONTENT.test(before)||SECRET_CONTENT.test(after))entry={path:rel,action:'restore',omittedReason:'sensitive-content'};
      else {const diff=createUnifiedTextDiff(rel,before,after);entry=diff.length>MAX_FILE_DIFF_CHARS?{path:rel,action:'restore',omittedReason:'diff-too-large'}:{path:rel,action:'restore',diff};}
      if(diffs.length>=MAX_DIFF_FILES||totalDiffChars+(entry.diff?.length??0)>MAX_DIFF_TOTAL_CHARS){truncatedFiles++;continue;}totalDiffChars+=entry.diff?.length??0;diffs.push(entry);
    }
    const excluded=new Set(value.excludedPaths??[]);
    const remove=[...current].filter(path=>{const rel=relative(this.root,path).split(sep).join('/');return !target.has(path)&&!SECRET_PATH.test(rel)&&!excluded.has(rel)&&!rel.startsWith('.isla-local/');}).map(path=>relative(this.root,path).split(sep).join('/'));
    for(const rel of remove){if(diffs.length>=MAX_DIFF_FILES){truncatedFiles++;continue;}diffs.push({path:rel,action:'remove',omittedReason:'not-in-checkpoint'});}
    return {id,restore,remove,diffs,truncatedFiles};
  }
  async restore(id:string, approved:boolean): Promise<void> {
    if(!approved) throw new Error('CHECKPOINT_RESTORE_REQUIRES_APPROVAL'); const value=await this.load(id);
    const diff=await this.preview(id); for(const rel of diff.remove){const path=resolve(this.root,rel);await assertSafePath(this.root,path);if(!SECRET_PATH.test(rel))await rm(path,{force:true});}
    for(const rel of diff.restore){const path=resolve(this.root,rel);await assertSafePath(this.root,path);const content=value.files[rel];if(content===undefined||SECRET_PATH.test(rel)||path.startsWith(this.directory+sep))continue;await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,content,'utf8');}
  }
  private async load(id:string):Promise<WorkspaceCheckpointV1>{if(!/^[0-9a-f-]{36}$/iu.test(id))throw new Error('CHECKPOINT_NOT_FOUND');const p=join(this.directory,`${id}.json`);const v=JSON.parse(await readFile(p,'utf8')) as WorkspaceCheckpointV1;if(v.version!==1||resolve(v.workspace)!==this.root||!v.files||typeof v.files!=='object')throw new Error('CHECKPOINT_WORKSPACE_MISMATCH');for(const rel of Object.keys(v.files))assertInside(this.root,resolve(this.root,rel));return v;}
}
export function formatWorkspaceCheckpointPreview(preview:WorkspaceCheckpointPreview):string{const lines=[`Checkpoint ${preview.id}`,'','将恢复：',...(preview.restore.length?preview.restore.map(path=>`  ${path}`):['  （无）']),'','将移除：',...(preview.remove.length?preview.remove.map(path=>`  ${path}`):['  （无）'])];for(const entry of preview.diffs){lines.push('',`[${entry.action==='restore'?'恢复':'移除'}] ${entry.path}`);if(entry.diff)lines.push(entry.diff);else lines.push(`差异内容已省略：${entry.omittedReason??'unknown'}`);}if(preview.truncatedFiles)lines.push('',`另有 ${preview.truncatedFiles} 个文件差异因输出上限而省略。`);return lines.join('\n');}
async function walk(root:string,dir=root):Promise<string[]>{const out:string[]=[];for(const entry of await readdir(dir,{withFileTypes:true})){if(SKIP.has(entry.name))continue;const p=join(dir,entry.name);if(entry.isSymbolicLink())continue;if(entry.isDirectory())out.push(...await walk(root,p));else if(entry.isFile())out.push(p);}return out;}
async function workspaceFiles(root:string):Promise<string[]>{const walked=await walk(root);try{const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const {stdout}=await promisify(execFile)('git',['ls-files','-co','--exclude-standard','-z'],{cwd:root,windowsHide:true,maxBuffer:8*1024*1024});const allowed=new Set(stdout.split('\0').filter(Boolean).map(p=>resolve(root,p)));return walked.filter(path=>allowed.has(path));}catch{return walked;}}
function assertInside(root:string,path:string):void{const rel=relative(root,path);if(!rel||rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel))throw new Error('CHECKPOINT_PATH_OUTSIDE_WORKSPACE');}
async function assertSafePath(root:string,path:string):Promise<void>{assertInside(root,path);const rel=relative(root,path).split(sep);let current=root;for(const part of rel){current=join(current,part);try{if((await lstat(current)).isSymbolicLink())throw new Error('CHECKPOINT_SYMLINK_PATH_DENIED');}catch(error){if(error instanceof Error&&error.message==='CHECKPOINT_SYMLINK_PATH_DENIED')throw error;break;}}}
function createUnifiedTextDiff(path:string,before:string,after:string):string{const oldLines=before.split(/\r?\n/u);const newLines=after.split(/\r?\n/u);let prefix=0;while(prefix<oldLines.length&&prefix<newLines.length&&oldLines[prefix]===newLines[prefix])prefix++;let suffix=0;while(suffix<oldLines.length-prefix&&suffix<newLines.length-prefix&&oldLines[oldLines.length-1-suffix]===newLines[newLines.length-1-suffix])suffix++;const contextStart=Math.max(0,prefix-2);const oldEnd=Math.min(oldLines.length,oldLines.length-suffix+2);const newEnd=Math.min(newLines.length,newLines.length-suffix+2);const oldRegion=oldLines.slice(contextStart,oldEnd);const newRegion=newLines.slice(contextStart,newEnd);const lines=[`--- a/${path}`,`+++ b/${path}`,`@@ -${contextStart+1},${oldRegion.length} +${contextStart+1},${newRegion.length} @@`,...oldLines.slice(contextStart,prefix).map(line=>` ${line}`),...oldLines.slice(prefix,oldLines.length-suffix).map(line=>`-${line}`),...newLines.slice(prefix,newLines.length-suffix).map(line=>`+${line}`),...oldLines.slice(oldLines.length-suffix,oldEnd).map(line=>` ${line}`)];return lines.join('\n');}
async function gitSummaryAt(root:string):Promise<{gitHead?:string;gitIndexSummary?:string;gitWorktreeSummary?:string}>{try{const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const run=promisify(execFile);const [{stdout:head},{stdout:index},{stdout:worktree}]=await Promise.all([run('git',['rev-parse','HEAD'],{cwd:root,windowsHide:true}),run('git',['diff','--cached','--name-status'],{cwd:root,windowsHide:true}),run('git',['status','--short','--untracked-files=all'],{cwd:root,windowsHide:true})]);const gitHead=head.trim();return {...(gitHead?{gitHead}:{}),gitIndexSummary:index.trim(),gitWorktreeSummary:worktree.trim()};}catch{return {};}}

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceCheckpointStore } from '../../src/checkpoints/workspace-checkpoint.js';

const roots:string[]=[];
async function root(){const p=await mkdtemp(join(tmpdir(),'isla-checkpoint-'));roots.push(p);return p;}
afterEach(async()=>{await Promise.all(roots.splice(0).map(async p=>{for(let i=0;i<5;i++){try{await rm(p,{recursive:true,force:true,maxRetries:5,retryDelay:100});return;}catch(error){if(i===4)throw error;await new Promise(resolve=>setTimeout(resolve,100));}}}));});
describe('WorkspaceCheckpointStore',()=>{
 it('captures a baseline, previews and restores only workspace files',async()=>{const dir=await root();await writeFile(join(dir,'a.txt'),'before');await writeFile(join(dir,'large.bin'),Buffer.alloc(1_000_001));const store=new WorkspaceCheckpointStore(dir);const cp=await store.create();await writeFile(join(dir,'a.txt'),'after');await writeFile(join(dir,'new.txt'),'new');await writeFile(join(dir,'large.bin'),Buffer.alloc(1_000_002));expect(await store.preview(cp.id)).toMatchObject({restore:['a.txt'],remove:['new.txt']});await expect(store.restore(cp.id,false)).rejects.toThrow('CHECKPOINT_RESTORE_REQUIRES_APPROVAL');await store.restore(cp.id,true);expect(await readFile(join(dir,'a.txt'),'utf8')).toBe('before');expect((await readFile(join(dir,'large.bin'))).byteLength).toBe(1_000_002);});
 it('excludes credentials, Resource data and does not cross workspace boundaries',async()=>{const dir=await root();await mkdir(join(dir,'resource'));await writeFile(join(dir,'.env'),'safe-looking');await writeFile(join(dir,'note.txt'),'ordinary');await writeFile(join(dir,'resource','state.db'),'private runtime data');const store=new WorkspaceCheckpointStore(dir);const cp=await store.create();expect(cp.files).not.toHaveProperty('.env');expect(Object.keys(cp.files).some(path=>path.includes('resource/'))).toBe(false);await expect(store.preview('00000000-0000-0000-0000-000000000000')).rejects.toThrow();});
});

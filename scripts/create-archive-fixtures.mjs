import { mkdirSync, rmSync, writeFileSync, renameSync, cpSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = join(process.cwd(), '.runtime', 'archive-fixtures');
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
const input = join(root, 'input');
mkdirSync(input, { recursive: true });
writeFileSync(join(input, '中文资料.txt'), 'Isla archive fixture\n', 'utf8');
writeFileSync(join(input, 'nested.json'), JSON.stringify({ fixture: true }), 'utf8');
const sevenZip = process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? '', 'Isla', 'tools', '7zip', '26.00', '7z.exe') : '7zz';
function archive(output, source, extra = []) { const result = spawnSync(sevenZip, ['a', output, source, '-mx=1', ...extra], { stdio: 'inherit', shell: false }); if (result.status !== 0) throw new Error(`7z failed: ${output}`); }
archive(join(root, 'ordinary.zip'), join(input, '*'));
cpSync(join(root, 'ordinary.zip'), join(root, '中文资料.压缩包')); 
cpSync(join(root, 'ordinary.zip'), join(root, 'renamed.data'));
archive(join(root, 'nested.zip'), join(root, 'renamed.data'));
archive(join(root, 'volumes.7z'), join(input, '*'), ['-v1k']);
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(24), Buffer.from('Rar!\x1a\x07\x01\x00', 'binary')]);
writeFileSync(join(root, 'video-with-archive-tail.mp4'), mp4);
console.log(`[archive-fixtures] generated ${readdirSync(root).length} fixtures in ${root}`);

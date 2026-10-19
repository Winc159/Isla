import { createHash } from 'node:crypto';
import { createWriteStream, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync as runSync } from 'node:child_process';
import https from 'node:https';

const VERSION = '3.8.4';
const BASE_URL = `https://issuecdn.baidupcs.com/issue/netdisk/ai-bdpan/installer/${VERSION}`;
const WINDOWS_SHA256 = '194f5174bbb3d9260cc5b7d465c4f98d6b9279e028db136dc1e57cc3bc1f49a0';
const force = process.argv.includes('--force');
const yes = process.argv.includes('--yes');
if (process.platform !== 'win32') { console.error('此适配器只负责 Windows；Linux/macOS 请使用官方 install.sh。'); process.exit(2); }
if (process.arch !== 'x64') { console.error(`暂不支持 Windows ${process.arch}；官方适配器当前只锁定 amd64。`); process.exit(2); }

const existing = commandPath('bdpan');
if (existing && !force) { console.log(`检测到已安装 bdpan：${existing}`); console.log('如需固定版本重装，请显式使用 --force。'); process.exit(0); }
const installer = join(tmpdir(), `bdpan-installer-windows-amd64-${VERSION}.exe`);
try {
  console.log(`下载 bdpan CLI v${VERSION}（Windows x64）...`);
  await download(`${BASE_URL}/bdpan-installer-windows-amd64.exe`, installer);
  const actual = sha256(installer);
  if (actual !== WINDOWS_SHA256) throw new Error(`SHA256 校验失败：${actual}`);
  console.log('SHA256 校验通过。');
  const args = yes ? ['--yes'] : [];
  if (!yes) console.log('即将启动官方安装器；如需跳过其确认，请由用户显式传入 --yes。');
  await run(installer, args);
} finally { try { unlinkSync(installer); } catch {} }

function commandPath(command) { const result = spawnSync(command, ['version']); return result ? command : undefined; }
function spawnSync(command, args) { try { const child = runSync(command, args, { stdio: 'ignore', shell: false }); return child.status === 0 ? child : undefined; } catch { return undefined; } }
function sha256(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function download(url, destination) { return new Promise((resolve, reject) => { const request = https.get(url, response => { if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) return download(new URL(response.headers.location, url).toString(), destination).then(resolve, reject); if (response.statusCode !== 200) return reject(new Error(`下载失败 HTTP ${response.statusCode}`)); const file = createWriteStream(destination); response.pipe(file); file.once('finish', () => file.close(resolve)); file.once('error', reject); }); request.once('error', reject); }); }
function run(command, args) { return new Promise((resolve, reject) => { const child = spawn(command, args, { stdio: 'inherit', shell: false, windowsHide: false }); child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(`安装器退出码 ${code ?? 1}`))); }); }

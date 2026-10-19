import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import https from 'node:https';

const VERSION = '26.00';
const DOWNLOAD_URL = 'https://www.7-zip.org/a/7z2600-x64.exe';
const SHA256 = '6fe18d5b3080e39678cabfa6cef12cfb25086377389b803a36a3c43236a8a82c';
const force = process.argv.includes('--force');
if (process.platform !== 'win32' || process.arch !== 'x64') { console.log(`[archive-tools] Windows x64 installer skipped on ${process.platform}/${process.arch}`); process.exit(0); }
const root = join(process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? tmpdir(), 'AppData', 'Local'), 'Isla', 'tools', '7zip', VERSION);
const executable = join(root, '7z.exe');
if (existsSync(executable) && !force) { console.log(`[archive-tools] 7-Zip ${VERSION} already installed: ${executable}`); process.exit(0); }
mkdirSync(root, { recursive: true });
const installer = join(tmpdir(), `isla-7zip-${VERSION}.exe`);
try {
  console.log(`[archive-tools] downloading 7-Zip ${VERSION}...`);
  await download(DOWNLOAD_URL, installer);
  const actual = createHash('sha256').update(readFileSync(installer)).digest('hex');
  if (actual !== SHA256) throw new Error(`SHA256 mismatch: ${actual}`);
  await run(installer, ['/S', `/D=${root}`]);
  if (!existsSync(executable)) throw new Error(`7-Zip installation did not produce ${executable}`);
  console.log(`[archive-tools] installed: ${executable}`);
} finally { try { unlinkSync(installer); } catch {} }
function download(url, destination) {
  if (process.platform === 'win32') return new Promise((resolve, reject) => { const child = spawn('powershell.exe', ['-NoProfile', '-Command', '& { param($u,$o) Invoke-WebRequest -Uri $u -OutFile $o }', url, destination], { stdio: 'inherit' }); child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(`PowerShell download exited ${code ?? 1}`))); });
  return new Promise((resolve, reject) => { const request = https.get(url, response => { if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) return download(new URL(response.headers.location, url).toString(), destination).then(resolve, reject); if (response.statusCode !== 200) return reject(new Error(`HTTP ${response.statusCode}`)); const file = createWriteStream(destination); response.pipe(file); file.once('finish', () => file.close(resolve)); file.once('error', reject); }); request.once('error', reject); });
}
function run(command, args) { return new Promise((resolve, reject) => { const child = spawn(command, args, { stdio: 'inherit', windowsHide: false }); child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(`installer exited ${code ?? 1}`))); }); }

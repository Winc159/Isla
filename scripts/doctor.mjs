import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const required = [['node', 'Node.js runtime']];
const optional = [['7z', '7-Zip compatibility command'], ['unrar', 'RAR fallback'], ['bdpan', 'Baidu Pan runner']];
let failed = false;
for (const [command, label] of required) { const path = find(command); if (!path) { failed = true; console.error(`[doctor] missing ${label}: ${command}`); } else console.log(`[doctor] ok ${label}: ${path}`); }
for (const [command, label] of optional) { const path = find(command); console.log(`[doctor] ${path ? 'ok' : 'optional-missing'} ${label}: ${path ?? command}`); }
const localSevenZip = process.platform === 'win32' ? `${process.env.LOCALAPPDATA ?? ''}/Isla/tools/7zip/26.00/7z.exe` : undefined;
if (localSevenZip && existsSync(localSevenZip)) console.log(`[doctor] ok Isla-managed 7-Zip: ${localSevenZip}`);
else if (!find('7zz') && !find('7z')) { failed = true; console.error('[doctor] missing 7-Zip archive tool: install:all or the platform package manager'); }
if (failed) { console.error('[doctor] run `npm run install:all` and then retry. Linux/macOS require 7zz/7z from the system package manager.'); process.exit(1); }
function find(command) { const probe = process.platform === 'win32' ? 'where.exe' : 'which'; const result = spawnSync(probe, [command], { encoding: 'utf8', stdio: 'pipe' }); return result.status === 0 ? result.stdout.trim().split(/\r?\n/u)[0] : undefined; }

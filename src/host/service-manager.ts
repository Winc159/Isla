import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Writable } from 'node:stream';

const SERVICES = ['isla-host.service', 'isla-resource.service'] as const;

export async function runServiceCommand(args: readonly string[], output: Writable = process.stdout): Promise<void> {
  if (process.platform !== 'linux') throw new Error('服务管理目前只支持 Linux systemd user service。');
  const action = args[0] ?? 'status';
  if (action === 'install') { await installServices(output); return; }
  if (action === 'logs') { await systemctl(['journalctl', '--user', '-u', 'isla-host.service', '-u', 'isla-resource.service', '-f']); return; }
  if (action !== 'start' && action !== 'stop' && action !== 'restart' && action !== 'status') throw new Error('用法：isla service [install|start|stop|restart|status|logs]');
  if ((action === 'start' || action === 'restart') && !(await serviceUnitsExist())) {
    await installServices(output);
    return;
  }
  if (action === 'status' && !(await serviceUnitsExist())) {
    output.write('Isla user services are not installed. Run `isla service install` or `isla service start`.\n');
    return;
  }
  await systemctl(['systemctl', '--user', action, ...SERVICES]);
}

async function serviceUnitsExist(): Promise<boolean> {
  const directory = join(homedir(), '.config', 'systemd', 'user');
  try { await Promise.all(SERVICES.map(service => access(join(directory, service)))); return true; } catch { return false; }
}

async function installServices(output: Writable): Promise<void> {
  const directory = join(homedir(), '.config', 'systemd', 'user');
  const dist = dirname(dirname(fileURLToPath(import.meta.url)));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'isla-host.service'), unit('Isla Resident Host', join(dist, 'entrypoints', 'host.js')), { encoding: 'utf8', mode: 0o644 });
  await writeFile(join(directory, 'isla-resource.service'), unit('Isla Resource Service', join(dist, 'entrypoints', 'resource.js'), 'isla-host.service'), { encoding: 'utf8', mode: 0o644 });
  await systemctl(['systemctl', '--user', 'daemon-reload']);
  await systemctl(['systemctl', '--user', 'enable', '--now', ...SERVICES]);
  output.write('Isla Host 与 Resource 已安装为当前用户的常驻服务。\n');
}

function unit(description: string, script: string, after?: string): string {
  const node = systemdQuote(process.execPath);
  const entry = systemdQuote(script);
  return `[Unit]\nDescription=${description}\nAfter=network-online.target${after ? ` ${after}` : ''}\nWants=network-online.target\n\n[Service]\nType=simple\nExecStart=${node} ${entry}\nRestart=on-failure\nRestartSec=3\nNoNewPrivileges=true\nPrivateTmp=true\n\n[Install]\nWantedBy=default.target\n`;
}

function systemdQuote(value: string): string { return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`; }
async function systemctl(command: readonly string[]): Promise<void> {
  const [program, ...args] = command;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(program!, args, { stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`${program} exited with code ${code ?? 1}`)));
  });
}

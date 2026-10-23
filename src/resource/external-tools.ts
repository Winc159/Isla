import { spawn } from "node:child_process";

export interface ExternalToolSpec { readonly id: string; readonly commands: readonly string[]; readonly versionArgs: readonly string[]; readonly minimumVersion?: string; readonly required: boolean; }
export interface ExternalToolReport { readonly id: string; readonly status: "available" | "missing" | "failed"; readonly command?: string; readonly version?: string; readonly reason?: string; }
export const RESOURCE_EXTERNAL_TOOLS: readonly ExternalToolSpec[] = [
  { id: "archive-primary", commands: ["7zz", "7z"], versionArgs: ["-version"], required: true },
  { id: "archive-rar-fallback", commands: ["unrar"], versionArgs: ["-version"], required: false },
];
export async function probeExternalTool(spec: ExternalToolSpec, runner: (command: string, args: readonly string[]) => Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> = runCommand): Promise<ExternalToolReport> {
  for (const command of spec.commands) { try { const result = await runner(command, spec.versionArgs); if (result.code === 0) return { id: spec.id, status: "available", command, version: sanitizeVersion(result.stdout || result.stderr) }; } catch { /* 尝试同一能力的下一个候选命令 */ } }
  return { id: spec.id, status: "missing", reason: "没有找到可执行的候选命令" };
}
export async function probeResourceExternalTools(): Promise<readonly ExternalToolReport[]> { return Promise.all(RESOURCE_EXTERNAL_TOOLS.map(spec => { const commands = spec.id === "archive-primary" && process.env.ISLA_7Z_PATH ? [process.env.ISLA_7Z_PATH, ...spec.commands] : spec.commands; return probeExternalTool({ ...spec, commands }); })); }
function runCommand(command: string, args: readonly string[]): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> { return new Promise((resolve, reject) => { const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: false }); let stdout = ""; let stderr = ""; child.stdout.on("data", chunk => { stdout += chunk.toString(); }); child.stderr.on("data", chunk => { stderr += chunk.toString(); }); child.once("error", reject); child.once("close", code => resolve({ code: code ?? 1, stdout, stderr })); }); }
function sanitizeVersion(value: string): string { return value.replaceAll(/\s+/gu, " ").trim().slice(0, 256); }

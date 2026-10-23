import { spawn } from "node:child_process";

export interface BdpanContext { readonly agentName: string; readonly sessionInput: string; readonly sessionId: string; readonly uid?: string; readonly traceId?: string; }
export interface BdpanCommandResult { readonly code: number; readonly stdout: string; readonly stderr: string; }

export function buildBdpanArgs(command: "whoami" | "ls" | "download" | "transfer", args: readonly string[], context: BdpanContext): readonly string[] {
  if (!context.agentName.trim() || !context.sessionInput.trim() || !context.sessionId.trim()) throw new Error("BDPAN_CONTEXT_REQUIRED");
  if (args.includes("login") || args.includes("--get-auth-url") || args.includes("--set-code") || args.includes("--set-code-stdin")) throw new Error("BDPAN_LOGIN_MUST_USE_SKILL_SCRIPT");
  if (args.some(argument => argument.includes("\0"))) throw new Error("BDPAN_ARGUMENT_INVALID");
  if ((command === "ls" || command === "transfer") && args.some(argument => argument.startsWith("/") && argument !== "/" && argument !== "/apps/bdpan" && !argument.startsWith("/apps/bdpan/"))) throw new Error("BDPAN_REMOTE_PATH_FORBIDDEN");
  return [command, ...args, "--json", "--agentname", context.agentName, "--session-input", context.sessionInput, "--session-id", context.sessionId, ...(context.uid ? ["--uid", context.uid] : []), ...(context.traceId ? ["--traceid", context.traceId] : [])];
}

export class BdpanRunner {
  constructor(private readonly command = "bdpan", private readonly configPath = process.env.BDPAN_CONFIG_PATH) {}
  run(operation: "whoami" | "ls" | "download" | "transfer", args: readonly string[], context: BdpanContext, signal?: AbortSignal): Promise<BdpanCommandResult> {
    const baseArgs = buildBdpanArgs(operation, args, context);
    const argv = this.configPath ? ["--config-path", this.configPath, ...baseArgs] : baseArgs;
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, argv, { shell: false, stdio: ["ignore", "pipe", "pipe"] }); let stdout = ""; let stderr = "";
      const abort = () => { child.kill(); reject(new Error("BDPAN_CANCELLED")); };
      signal?.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", chunk => { stdout += chunk.toString(); }); child.stderr.on("data", chunk => { stderr += chunk.toString(); });
      child.once("error", error => { signal?.removeEventListener("abort", abort); reject(error); });
      child.once("close", code => { signal?.removeEventListener("abort", abort); resolve({ code: code ?? 1, stdout, stderr: sanitizeStderr(stderr) }); });
    });
  }

  async list(path: string, context: BdpanContext, signal?: AbortSignal): Promise<BdpanCommandResult> {
    if (!path.startsWith("/")) throw new Error("BDPAN_REMOTE_PATH_INVALID");
    return this.run("ls", [path, "--limit", "1000"], context, signal);
  }
  async loginUrl(context: BdpanContext): Promise<BdpanCommandResult> { return this.runLogin(["login", "--get-auth-url"], context); }
  async loginCode(code: string, context: BdpanContext): Promise<BdpanCommandResult> { if (!code.trim() || code.length > 1024) throw new Error("BDPAN_AUTH_CODE_INVALID"); return this.runLogin(["login", "--set-code-stdin"], context, code.trim()); }
  private runLogin(args: readonly string[], context: BdpanContext, stdin?: string): Promise<BdpanCommandResult> { const argv = this.configPath ? ["--config-path", this.configPath, ...args, "--json", "--agentname", context.agentName, "--session-input", context.sessionInput, "--session-id", context.sessionId] : [...args, "--json", "--agentname", context.agentName, "--session-input", context.sessionInput, "--session-id", context.sessionId]; return new Promise((resolve, reject) => { const child = spawn(this.command, argv, { shell: false, stdio: [stdin ? "pipe" : "ignore", "pipe", "pipe"] }); if (stdin) { child.stdin?.end(`${stdin}\n`); } let stdout = ""; let stderr = ""; child.stdout!.on("data", chunk => { stdout += chunk.toString(); }); child.stderr!.on("data", chunk => { stderr += chunk.toString(); }); child.once("error", reject); child.once("close", code => resolve({ code: code ?? 1, stdout, stderr: sanitizeStderr(stderr) })); }); }
}

function sanitizeStderr(value: string): string { return value.replaceAll(/(?:access[_-]?token|cookie|authorization|token)\s*[:=]\s*[^\s,;]+/giu, "$1=[REDACTED]").slice(0, 8_192); }

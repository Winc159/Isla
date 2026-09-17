import { relative } from "node:path";
import { ToolFailure, invalidArguments } from "./errors.js";
import { runCommand, type CommandRunRequest } from "./subprocess-runner.js";
import type { Tool, ToolCapability, ToolOutput } from "./types.js";

interface CommandInput { readonly command: string; readonly workdir?: string; readonly timeoutMs?: number; }

export function createCommandExecutionCapability(workspaceRoot: string): ToolCapability {
  return {
    id: "command-execution",
    instructions: [
      "需要验证修改或运行项目检查时使用 run_command。",
      "命令在 Workspace 内的指定工作目录运行；长时间运行的命令必须通过 timeoutMs 控制。",
      "命令的非零退出、超时和标准错误都是执行结果的一部分；读取结果后再决定是否修复或重试。",
      "不要把 API Key、令牌或私人内容放入命令。命令执行需要用户批准。",
    ].join("\n"),
    tools: [createRunCommandTool(workspaceRoot)],
  };
}

export function createRunCommandTool(workspaceRoot: string): Tool {
  return {
    permission: { kind: "command-execute" },
    definition: {
      name: "run_command",
      description: "在 Workspace 内以前台方式运行一次 PowerShell 或 Bash 命令，并返回有界 stdout、stderr 和退出状态。",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "要执行的 Shell 命令" },
          workdir: { type: "string", description: "Workspace 内的相对工作目录，默认是 Workspace 根目录" },
          timeoutMs: { type: "number", description: "超时时间（毫秒），默认 120000，最大 600000" },
        },
        required: ["command"],
        additionalProperties: false,
      },
    },
    describe(argumentsJson) {
      const input = parseInput(argumentsJson);
      const workdir = input.workdir ?? "";
      const timeout = input.timeoutMs === undefined ? "默认超时" : `${input.timeoutMs}ms 超时`;
      return `运行命令（工作目录：${workdir || "."}；${timeout}）：${sanitizeCommand(input.command)}`;
    },
    async execute(argumentsJson, options = {}): Promise<ToolOutput> {
      const input = parseInput(argumentsJson);
      let result;
      try {
        result = await runCommand(workspaceRoot, { ...input, ...(options.signal ? { signal: options.signal } : {}) });
      } catch (error) {
        if (error instanceof ToolFailure) throw error;
        throw new ToolFailure(error instanceof Error && error.message.includes("workdir") ? "SANDBOX_DENIED" : "COMMAND_EXECUTION_FAILED", error instanceof Error ? error.message : String(error));
      }
      const output = [`stdout:\n${result.stdout.text}`, `stderr:\n${result.stderr.text}`, `exit code: ${result.exitCode ?? "null"}`];
      if (result.timedOut) output.push("timed out: true");
      if (result.aborted) output.push("aborted: true");
      if (result.stdout.truncated) output.push("stdout truncated: true");
      if (result.stderr.truncated) output.push("stderr truncated: true");
      return {
        content: output.join("\n\n"),
        details: {
          type: "command_execution",
          shell: result.shell,
          workdir: relative(workspaceRoot, result.workdir) || ".",
          exitCode: result.exitCode,
          signal: result.signal,
          timedOut: result.timedOut,
          aborted: result.aborted,
          stdoutTruncated: result.stdout.truncated,
          stderrTruncated: result.stderr.truncated,
        },
      };
    },
  };
}

function parseInput(argumentsJson: string): CommandInput {
  let value: unknown;
  try { value = JSON.parse(argumentsJson); } catch { throw invalidArguments("run_command arguments must be valid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidArguments("run_command arguments must be an object");
  const input = value as Record<string, unknown>;
  if (typeof input.command !== "string" || !input.command.trim()) throw invalidArguments("run_command command must be a non-empty string");
  if (input.workdir !== undefined && typeof input.workdir !== "string") throw invalidArguments("run_command workdir must be a string");
  if (input.timeoutMs !== undefined && (typeof input.timeoutMs !== "number" || !Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0)) throw invalidArguments("run_command timeoutMs must be a positive finite number");
  return { command: input.command, ...(input.workdir !== undefined ? { workdir: input.workdir } : {}), ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}) };
}

function sanitizeCommand(command: string): string {
  return command.replace(/(KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|AUTHORIZATION|CREDENTIAL|COOKIE|SESSION)\s*=\s*[^\s;|]+/gi, "$1=<redacted>").slice(0, 240);
}

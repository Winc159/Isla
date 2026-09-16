import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { SandboxPolicy } from "../sandbox/policy.js";
import type { Tool } from "./types.js";
import { invalidArguments } from "./errors.js";
import type { TextFileObservations } from "./text-file-observations.js";

export function createWriteTextFileTool(rootDirectory: string, observations?: TextFileObservations): Tool {
  const sandbox = new SandboxPolicy(rootDirectory);
  return {
    permission: { kind: "filesystem-write" },
    definition: {
      name: "write_text_file",
      description: "写入项目目录内的文本文件。用户明确要求写入时直接调用；执行前批准由 Runtime 处理。",
      parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"], additionalProperties: false },
    },
    async describe(argumentsJson: string): Promise<string> {
      const value = parseWriteArguments(argumentsJson);
      const target = await sandbox.resolvePath(value.path, "write");
      const action = await access(target).then(() => "覆盖", () => "创建");
      const preview = value.content.replaceAll("\r", "\\r").replaceAll("\n", "\\n").slice(0, 80);
      return `${action}文本文件 ${value.path}；${value.content.length} 个字符；内容预览：${preview}${value.content.length > 80 ? "…" : ""}`;
    },
    async execute(argumentsJson: string, options = {}): Promise<string> {
      if (options.signal?.aborted) throw new Error("当前回合已取消。");
      const value = parseWriteArguments(argumentsJson);
      const target = await sandbox.resolvePath(value.path, "write");
      if (options.signal?.aborted) throw new Error("当前回合已取消。");
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, value.content, "utf8");
      observations?.observe(target, value.content);
      return `已写入 ${value.path}`;
    },
  };
}

function parseWriteArguments(argumentsJson: string): { path: string; content: string } {
  let args: unknown;
  try { args = JSON.parse(argumentsJson); } catch { throw invalidArguments("write_text_file arguments must be valid JSON"); }
  if (typeof args !== "object" || args === null || typeof (args as { path?: unknown }).path !== "string" || typeof (args as { content?: unknown }).content !== "string") throw invalidArguments("write_text_file requires path and content");
  return args as { path: string; content: string };
}

import { randomUUID } from "node:crypto";
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { SandboxPolicy } from "../sandbox/policy.js";
import { ToolFailure, invalidArguments } from "./errors.js";
import type { TextFileObservations } from "./text-file-observations.js";
import type { Tool } from "./types.js";

interface EditArguments {
  readonly path: string;
  readonly oldText: string;
  readonly newText: string;
  readonly replaceAll: boolean;
}

export function createEditTextFileTool(rootDirectory: string, observations: TextFileObservations): Tool {
  const sandbox = new SandboxPolicy(rootDirectory);
  return {
    permission: { kind: "filesystem-write" },
    definition: {
      name: "edit_text_file",
      description: "精确修改已读取的项目文本文件。默认要求 oldText 唯一匹配；多处替换必须显式设置 replaceAll。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对于项目目录的文件路径" },
          oldText: { type: "string", description: "必须与文件内容精确匹配的非空旧文本" },
          newText: { type: "string", description: "替换后的文本" },
          replaceAll: { type: "boolean", description: "是否替换全部非重叠匹配，默认 false" },
        },
        required: ["path", "oldText", "newText"],
        additionalProperties: false,
      },
    },
    async describe(argumentsJson: string): Promise<string> {
      const value = parseEditArguments(argumentsJson);
      return `精确编辑文本文件 ${value.path}；旧文本 ${value.oldText.length} 个字符；新文本 ${value.newText.length} 个字符；${value.replaceAll ? "替换全部匹配" : "要求唯一匹配"}`;
    },
    async execute(argumentsJson: string, options = {}): Promise<string> {
      if (options.signal?.aborted) throw new Error("当前回合已取消。");
      const value = parseEditArguments(argumentsJson);
      const target = await sandbox.resolvePath(value.path, "write");
      const observedRevision = observations.revision(target);
      if (!observedRevision) throw new ToolFailure("FILE_NOT_OBSERVED", "edit_text_file requires reading the target file first");
      const targetStat = await stat(target);
      const current = await readFile(target, "utf8");
      if (!observations.matches(target, current)) throw new ToolFailure("FILE_STALE", "target file changed after it was read; read it again before editing");
      const matches = countMatches(current, value.oldText);
      if (matches === 0) throw new ToolFailure("EDIT_NO_MATCH", "oldText does not match the current file content");
      if (matches > 1 && !value.replaceAll) throw new ToolFailure("EDIT_MULTIPLE_MATCHES", "oldText matches more than once; provide more context or set replaceAll");
      const updated = value.replaceAll ? current.replaceAll(value.oldText, value.newText) : current.replace(value.oldText, value.newText);
      if (options.signal?.aborted) throw new Error("当前回合已取消。");
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, updated, { encoding: "utf8", flag: "wx", mode: targetStat.mode });
        if (options.signal?.aborted) throw new Error("当前回合已取消。");
        const beforeReplace = await readFile(target, "utf8");
        if (!observations.matches(target, beforeReplace)) throw new ToolFailure("FILE_STALE", "target file changed while editing; read it again before retrying");
        await rename(temporary, target);
        observations.observe(target, updated);
      } finally {
        await unlink(temporary).catch(() => {});
      }
      return `已编辑 ${value.path}；替换 ${value.replaceAll ? matches : 1} 处`;
    },
  };
}

function parseEditArguments(argumentsJson: string): EditArguments {
  let args: unknown;
  try { args = JSON.parse(argumentsJson); } catch { throw invalidArguments("edit_text_file arguments must be valid JSON"); }
  if (typeof args !== "object" || args === null) throw invalidArguments("edit_text_file arguments must be an object");
  const value = args as { path?: unknown; oldText?: unknown; newText?: unknown; replaceAll?: unknown };
  if (typeof value.path !== "string" || !value.path.trim()) throw invalidArguments("edit_text_file path must be a non-empty relative path");
  if (typeof value.oldText !== "string" || value.oldText.length === 0) throw invalidArguments("edit_text_file oldText must be a non-empty string");
  if (typeof value.newText !== "string") throw invalidArguments("edit_text_file newText must be a string");
  if (value.replaceAll !== undefined && typeof value.replaceAll !== "boolean") throw invalidArguments("edit_text_file replaceAll must be a boolean");
  return { path: value.path, oldText: value.oldText, newText: value.newText, replaceAll: value.replaceAll ?? false };
}

function countMatches(content: string, search: string): number {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = content.indexOf(search, offset);
    if (index === -1) return count;
    count += 1;
    offset = index + search.length;
  }
}

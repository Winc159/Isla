import { readFile } from "node:fs/promises";
import type { Tool } from "./types.js";
import { SandboxPolicy } from "../sandbox/policy.js";
import { invalidArguments } from "./errors.js";

export function createReadTextFileTool(rootDirectory: string): Tool {
  const sandbox = new SandboxPolicy(rootDirectory);
  return {
    permission: { kind: "filesystem-read" },
    definition: {
      name: "read_text_file",
      description: "读取项目目录内的文本文件。需要查看项目文档或源码内容时使用。",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "相对于项目目录的文件路径" } },
        required: ["path"],
        additionalProperties: false,
      },
    },
    async execute(argumentsJson: string, options = {}): Promise<string> {
      if (options.signal?.aborted) throw new Error("当前回合已取消。");
      let args: unknown;
      try { args = JSON.parse(argumentsJson); } catch { throw invalidArguments("read_text_file arguments must be valid JSON"); }
      const path = typeof args === "object" && args !== null && "path" in args ? (args as { path?: unknown }).path : undefined;
      if (typeof path !== "string") throw invalidArguments("read_text_file path must be a non-empty relative path");
      const target = await sandbox.resolvePath(path, "read");
      if (options.signal?.aborted) throw new Error("当前回合已取消。");
      return readFile(target, "utf8");
    },
  };
}

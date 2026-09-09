import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { Tool } from "./types.js";

export function createReadTextFileTool(rootDirectory: string): Tool {
  const root = resolve(rootDirectory);
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
    async execute(argumentsJson: string): Promise<string> {
      let args: unknown;
      try { args = JSON.parse(argumentsJson); } catch { throw new Error("read_text_file arguments must be valid JSON"); }
      const path = typeof args === "object" && args !== null && "path" in args ? (args as { path?: unknown }).path : undefined;
      if (typeof path !== "string" || !path.trim() || isAbsolute(path)) throw new Error("read_text_file path must be a non-empty relative path");
      const target = resolve(root, path);
      const relativePath = relative(root, target);
      if (relativePath.startsWith("..") || isAbsolute(relativePath)) throw new Error("read_text_file path must stay inside the project directory");
      if ([".env", ".env.local", ".env.production"].includes(target.toLowerCase().split("\\").pop() ?? "")) throw new Error("read_text_file cannot read secret files");
      return readFile(target, "utf8");
    },
  };
}

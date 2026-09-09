import { readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { Tool } from "./types.js";

export function createListDirectoryTool(rootDirectory: string): Tool {
  const root = resolve(rootDirectory);
  return {
    permission: { kind: "filesystem-read" },
    definition: {
      name: "list_directory",
      description: "列出项目目录内指定目录的直接子项。需要定位项目文件时使用，不递归列出。",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "相对于项目目录的目录路径，空字符串表示项目根目录" } },
        required: ["path"],
        additionalProperties: false,
      },
    },
    async execute(argumentsJson: string): Promise<string> {
      let args: unknown;
      try { args = JSON.parse(argumentsJson); } catch { throw new Error("list_directory arguments must be valid JSON"); }
      const path = typeof args === "object" && args !== null && "path" in args ? (args as { path?: unknown }).path : undefined;
      if (typeof path !== "string" || isAbsolute(path)) throw new Error("list_directory path must be relative");
      const target = resolve(root, path);
      const relativePath = relative(root, target);
      if (relativePath.startsWith("..") || isAbsolute(relativePath)) throw new Error("list_directory path must stay inside the project directory");
      return (await readdir(target, { withFileTypes: true })).map(entry => `${entry.isDirectory() ? "dir" : "file"}\t${entry.name}`).join("\n");
    },
  };
}

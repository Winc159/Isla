import { readdir } from "node:fs/promises";
import type { Tool } from "./types.js";
import { SandboxPolicy } from "../sandbox/policy.js";
import { invalidArguments } from "./errors.js";

export function createListDirectoryTool(rootDirectory: string): Tool {
  const sandbox = new SandboxPolicy(rootDirectory);
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
      try { args = JSON.parse(argumentsJson); } catch { throw invalidArguments("list_directory arguments must be valid JSON"); }
      const path = typeof args === "object" && args !== null && "path" in args ? (args as { path?: unknown }).path : undefined;
      if (typeof path !== "string") throw invalidArguments("list_directory path must be relative");
      const target = await sandbox.resolveRootOrDirectory(path);
      return (await readdir(target, { withFileTypes: true })).map(entry => `${entry.isDirectory() ? "dir" : "file"}\t${entry.name}`).join("\n");
    },
  };
}

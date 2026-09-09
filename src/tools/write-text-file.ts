import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { SandboxPolicy } from "../sandbox/policy.js";
import type { Tool } from "./types.js";

export function createWriteTextFileTool(rootDirectory: string): Tool {
  const sandbox = new SandboxPolicy(rootDirectory);
  return {
    permission: { kind: "filesystem-write" },
    definition: {
      name: "write_text_file",
      description: "写入项目目录内的文本文件。修改文件前必须获得用户批准。",
      parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"], additionalProperties: false },
    },
    async execute(argumentsJson: string): Promise<string> {
      let args: unknown;
      try { args = JSON.parse(argumentsJson); } catch { throw new Error("write_text_file arguments must be valid JSON"); }
      if (typeof args !== "object" || args === null || typeof (args as { path?: unknown }).path !== "string" || typeof (args as { content?: unknown }).content !== "string") throw new Error("write_text_file requires path and content");
      const value = args as { path: string; content: string };
      const target = await sandbox.resolvePath(value.path, "write");
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, value.content, "utf8");
      return `已写入 ${value.path}`;
    },
  };
}

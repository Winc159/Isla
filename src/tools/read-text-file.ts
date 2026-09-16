import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import type { Tool } from "./types.js";
import { SandboxPolicy } from "../sandbox/policy.js";
import { invalidArguments } from "./errors.js";
import type { TextFileObservations } from "./text-file-observations.js";
import { buildTextReadResult, READ_MAX_LINES, READ_STREAM_MIN_SIZE } from "./read-text-window.js";

export function createReadTextFileTool(rootDirectory: string, observations?: TextFileObservations): Tool {
  const sandbox = new SandboxPolicy(rootDirectory);
  return {
    permission: { kind: "filesystem-read" },
    definition: {
      name: "read_text_file",
      description: "按行读取项目目录内的 UTF-8 文本文件，返回带行号的有界窗口。使用 offset 和 limit 分页读取大文件。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对于项目目录的文件路径" },
          offset: { type: "number", description: "从 1 开始的首行，默认 1" },
          limit: { type: "number", description: `最大返回行数，默认及最大 ${READ_MAX_LINES}` },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
    async execute(argumentsJson: string, options = {}): Promise<string> {
      if (options.signal?.aborted) throw new Error("当前回合已取消。");
      let args: unknown;
      try { args = JSON.parse(argumentsJson); } catch { throw invalidArguments("read_text_file arguments must be valid JSON"); }
      const value = typeof args === "object" && args !== null ? args as { path?: unknown; offset?: unknown; limit?: unknown } : {};
      const path = value.path;
      if (typeof path !== "string") throw invalidArguments("read_text_file path must be a non-empty relative path");
      const offset = positiveInteger(value.offset, "offset", 1);
      const limit = positiveInteger(value.limit, "limit", READ_MAX_LINES);
      if (limit > READ_MAX_LINES) throw invalidArguments(`read_text_file limit must be less than or equal to ${READ_MAX_LINES}`);
      const target = await sandbox.resolvePath(path, "read");
      if (options.signal?.aborted) throw new Error("当前回合已取消。");
      const info = await stat(target);
      if (!info.isFile()) throw new Error("read_text_file target must be a regular file");
      const chunks = info.size >= READ_STREAM_MIN_SIZE
        ? createReadStream(target, { encoding: "utf8", signal: options.signal }) as AsyncIterable<string>
        : [await readFile(target, "utf8")];
      const result = await buildTextReadResult(chunks, path, { offset, limit }, options.signal);
      if (options.signal?.aborted) throw new Error("当前回合已取消。");
      observations?.observeRevision(target, result.revision);
      return result.text;
    },
  };
}

function positiveInteger(value: unknown, name: "offset" | "limit", fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw invalidArguments(`read_text_file ${name} must be a positive integer`);
  return value;
}

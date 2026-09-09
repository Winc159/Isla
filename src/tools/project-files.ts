import { createListDirectoryTool } from "./list-directory.js";
import { createReadTextFileTool } from "./read-text-file.js";
import type { ToolCapability } from "./types.js";

export function createProjectFilesCapability(projectRoot: string): ToolCapability {
  return {
    id: "project-files",
    instructions: [
      "当回答依赖当前项目的文件、目录结构或文件内容时，必须使用工具获取真实信息。",
      "路径不确定时先调用 list_directory；路径明确时直接调用 read_text_file。",
      "不得根据历史上下文猜测当前文件状态。工具失败时如实说明，不得编造结果。",
    ].join("\n"),
    tools: [createListDirectoryTool(projectRoot), createReadTextFileTool(projectRoot)],
  };
}

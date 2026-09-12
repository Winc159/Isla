import { createListDirectoryTool } from "./list-directory.js";
import { createReadTextFileTool } from "./read-text-file.js";
import { createWriteTextFileTool } from "./write-text-file.js";
import { createSearchProjectTool } from "./search-project.js";
import type { ToolCapability } from "./types.js";

export function createProjectFilesCapability(projectRoot: string): ToolCapability {
  return {
    id: "project-files",
    instructions: [
      "当回答依赖当前项目的文件、目录结构或文件内容时，必须使用工具获取真实信息。",
      "路径不确定时先调用 search_project 或 list_directory；路径明确时直接调用 read_text_file。",
      "用户明确要求创建或修改文本文件时，直接返回 write_text_file Tool Call，不要先用自然语言询问是否确认。",
      "write_text_file 的执行前批准由 Runtime 自动发起和等待；你只负责发起 Tool Call。工具也可以创建不存在的父目录。",
      "严禁在没有收到 write_text_file 成功结果时声称文件已创建或修改；如果没有调用工具，只能说明尚未执行写入。",
      "工具被拒绝或失败时，必须如实说明，不能把计划、意图或模型推测描述为已经完成。",
      "不得根据历史上下文猜测当前文件状态。工具失败时如实说明，不得编造结果。",
    ].join("\n"),
    tools: [createListDirectoryTool(projectRoot), createReadTextFileTool(projectRoot), createSearchProjectTool(projectRoot), createWriteTextFileTool(projectRoot)],
  };
}

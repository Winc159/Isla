export const RESOURCE_TOOLBOX = [
  { id: "baidu-download", label: "百度下载", acceptsFolderSelection: true, requiresWorker: false, responsibilities: ["parse-share-text", "download", "queue-progress"] },
  { id: "archive-organizer", label: "文件解压/整理", acceptsFolderSelection: true, requiresWorker: false, responsibilities: ["inspect", "group-volumes", "extract", "name", "publish"] },
] as const;
export type ResourceToolboxId = typeof RESOURCE_TOOLBOX[number]["id"];

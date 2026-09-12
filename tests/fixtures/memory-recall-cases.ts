export const recallCases = [
  { query: "偏好简洁回答", expected: "偏好：简洁回答", forbidden: "候选：喜欢长篇展开", workspace: undefined },
  { query: "CONCISE answers", expected: "Preference: concise answers", forbidden: "Preference: verbose answers", workspace: undefined },
  { query: "Isla 的 ndjson 日志", expected: "Isla 使用 NDJSON 记录协议事件", forbidden: "Isla 使用 XML 记录协议事件", workspace: "D:/fictional/isla" },
  { query: "工作区构建命令", expected: "工作区构建命令是 npm run build", forbidden: "另一个工作区构建命令是 make", workspace: "D:/fictional/isla" },
] as const;

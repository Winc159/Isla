export interface ProjectSearchEvaluationCase {
  readonly name: string;
  readonly query: string;
  readonly path?: string;
  readonly files: readonly { readonly path: string; readonly content: string }[];
  readonly mustInclude: readonly string[];
  readonly mustExclude: readonly string[];
  readonly expectedTop1?: string;
  readonly expectedTop3?: readonly string[];
}

export const PROJECT_SEARCH_EVALUATION_CASES: readonly ProjectSearchEvaluationCase[] = [
  {
    name: "中文标点与正文",
    query: "审批流程",
    files: [{ path: "docs/policy.md", content: "项目说明\n审批流程，需要用户确认。\n" }, { path: "notes/unrelated.md", content: "天气和午餐。\n" }],
    mustInclude: ["docs/policy.md"], mustExclude: ["notes/unrelated.md"], expectedTop1: "docs/policy.md",
  },
  {
    name: "英文大小写",
    query: "session journal",
    files: [{ path: "src/journal.ts", content: "export const SessionJournal = true;\n" }, { path: "src/other.ts", content: "export const unrelated = true;\n" }],
    mustInclude: ["src/journal.ts"], mustExclude: ["src/other.ts"], expectedTop1: "src/journal.ts",
  },
  {
    name: "中英文混合与路径",
    query: "request snapshot",
    files: [{ path: "docs/request-snapshot.md", content: "模型请求快照用于验证。\n" }, { path: "docs/memory.md", content: "个人记忆。\n" }],
    mustInclude: ["docs/request-snapshot.md"], mustExclude: ["docs/memory.md"], expectedTop1: "docs/request-snapshot.md",
  },
  {
    name: "完整短语优先于单 term",
    query: "approval policy",
    files: [
      { path: "docs/policy.md", content: "The approval policy is documented here.\n" },
      { path: "docs/approval.md", content: "Approval is required for writes.\n" },
    ],
    mustInclude: ["docs/policy.md", "docs/approval.md"], mustExclude: [], expectedTop1: "docs/policy.md",
  },
  {
    name: "文件名完整命中",
    query: "request snapshot",
    files: [
      { path: "notes/request.md", content: "A request is recorded.\n" },
      { path: "docs/request-snapshot.md", content: "Model request snapshots are validated.\n" },
    ],
    mustInclude: ["notes/request.md", "docs/request-snapshot.md"], mustExclude: [], expectedTop1: "docs/request-snapshot.md",
  },
  {
    name: "primary term 全覆盖",
    query: "session journal",
    files: [
      { path: "docs/session.md", content: "Session lifecycle notes.\n" },
      { path: "src/journal.ts", content: "Session journal records are append-only.\n" },
    ],
    mustInclude: ["docs/session.md", "src/journal.ts"], mustExclude: [], expectedTop1: "src/journal.ts",
  },
  {
    name: "中文完整短语优先",
    query: "项目来源",
    files: [
      { path: "docs/source.md", content: "项目来源需要可核验。\n" },
      { path: "docs/project.md", content: "项目说明与目录。\n" },
    ],
    mustInclude: ["docs/source.md", "docs/project.md"], mustExclude: [], expectedTop1: "docs/source.md",
  },
  {
    name: "中英文混合 term",
    query: "source 来源",
    files: [
      { path: "docs/evidence.md", content: "Source 来源必须稳定。\n" },
      { path: "docs/unrelated.md", content: "Source code only.\n" },
    ],
    mustInclude: ["docs/evidence.md", "docs/unrelated.md"], mustExclude: [], expectedTop1: "docs/evidence.md",
  },
  {
    name: "路径范围缩小",
    query: "target",
    path: "src",
    files: [
      { path: "src/runtime.ts", content: "target behavior\n" },
      { path: "docs/runtime.md", content: "target documentation\n" },
    ],
    mustInclude: ["src/runtime.ts"], mustExclude: ["docs/runtime.md"], expectedTop1: "src/runtime.ts",
  },
  {
    name: "相同分数稳定排序",
    query: "checkpoint",
    files: [
      { path: "b/checkpoint.md", content: "checkpoint\n" },
      { path: "a/checkpoint.md", content: "checkpoint\n" },
    ],
    mustInclude: ["a/checkpoint.md", "b/checkpoint.md"], mustExclude: [], expectedTop1: "a/checkpoint.md",
  },
  {
    name: "历史文档竞争",
    query: "structured details",
    files: [
      { path: "docs/architecture-v0.2.4.md", content: "Tool structured details are authoritative.\n" },
      { path: "docs/architecture-v0.2.1.md", content: "Older architecture notes mention tools.\n" },
    ],
    mustInclude: ["docs/architecture-v0.2.4.md"], mustExclude: [], expectedTop1: "docs/architecture-v0.2.4.md",
  },
];

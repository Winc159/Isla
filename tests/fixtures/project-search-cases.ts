export interface ProjectSearchEvaluationCase {
  readonly name: string;
  readonly query: string;
  readonly files: readonly { readonly path: string; readonly content: string }[];
  readonly mustInclude: readonly string[];
  readonly mustExclude: readonly string[];
}

export const PROJECT_SEARCH_EVALUATION_CASES: readonly ProjectSearchEvaluationCase[] = [
  {
    name: "中文标点与正文",
    query: "审批流程",
    files: [{ path: "docs/policy.md", content: "项目说明\n审批流程，需要用户确认。\n" }, { path: "notes/unrelated.md", content: "天气和午餐。\n" }],
    mustInclude: ["docs/policy.md"], mustExclude: ["notes/unrelated.md"],
  },
  {
    name: "英文大小写",
    query: "session journal",
    files: [{ path: "src/journal.ts", content: "export const SessionJournal = true;\n" }, { path: "src/other.ts", content: "export const unrelated = true;\n" }],
    mustInclude: ["src/journal.ts"], mustExclude: ["src/other.ts"],
  },
  {
    name: "中英文混合与路径",
    query: "request snapshot",
    files: [{ path: "docs/request-snapshot.md", content: "模型请求快照用于验证。\n" }, { path: "docs/memory.md", content: "个人记忆。\n" }],
    mustInclude: ["docs/request-snapshot.md"], mustExclude: ["docs/memory.md"],
  },
];

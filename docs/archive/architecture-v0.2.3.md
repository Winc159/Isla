# Isla v0.2.3 架构基线：可验证的项目知识与行动闭环

## 1. 版本目标

v0.2.3 解决一个已经出现的真实问题：Isla 能读取单个已知文件，也能保存会话与个人记忆，但面对“项目当前如何实现”“相关代码在哪里”“结论依据什么”时，仍依赖模型猜测路径或逐层列目录，缺少确定性的项目检索与可定位证据。

本版建立以下闭环：

1. 在 workspace 内确定性发现和检索文本文件；
2. 将命中表示为有边界、有来源、可验证的 `ProjectSource`；
3. 通过只读 Tool 把检索能力接入现有 Agent Loop；
4. 让模型请求快照与 Journal 只记录安全的 source ID；
5. 最终回答在确有项目依据时输出简短来源列表；
6. 用完全离线的评测证明检索正确、无越界、无秘密泄漏。

`StoredSession.messages` 继续是唯一对话正文事实源。项目索引、检索命中、来源列表和 Journal 都不是第二份对话事实源。

## 2. 范围边界

本版包含：workspace 文本文件按需扫描；文件名、相对路径与正文关键词匹配；中英文查询；相对路径、1-based 行号、有限片段和稳定 source ID；只读 `search_project` Tool；请求快照和 Journal 的安全来源关联；可验证的最终来源列表；CLI/NDJSON 回归；离线检索评测集。

本版不包含：SQLite/FTS 项目索引、文件监听、Embedding、向量数据库、Shell、网络、MCP、Git 命令、并行 Tool、后台任务、子 Agent、自动修改文件、跨 workspace 检索、完整 DSH Session Query/Event Map/Surface。

不得把完整文件内容、Tool 参数或 Tool Result 写入 Journal，也不得把项目文件内容自动复制进 Memory。

## 3. DSH 参考与取舍

参考 DeepSeek Harness Session Query 的职责边界，而不复制其实现。

采用：查询与会话事实存储分离；结果具有稳定身份和可定位来源；过滤、排序、截断和失败语义由 Runtime 决定；查询结果是可重建的派生视图；Tool 边界与请求投影可审计。

暂缓：SQLite Session Query、全文索引、append-only Session Event、通用 Surface、查询 DSL 和跨会话/跨项目统一搜索。

拒绝：复制 DSH 源码、目录、Cordis 生命周期或 monorepo；让 DSH 成为运行时依赖；预建开放事件总线或通用检索平台。

重新评估条件：按需扫描在真实项目上产生可测量的不可接受延迟，或离线评测证明关键词方案不足。

## 4. 核心契约

建议新增独立模块 `src/project-search/`，不放入 `memory/`，避免混淆“当前 workspace 事实”和“长期个人记忆”。

```ts
export interface ProjectSearchQuery {
  readonly text: string;
  readonly path?: string;
  readonly limit?: number;
  readonly maxChars?: number;
  readonly contextLines?: number;
}

export interface ProjectSource {
  readonly id: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly excerpt: string;
}

export interface ProjectSearchResult {
  readonly sources: readonly ProjectSource[];
  readonly filesScanned: number;
  readonly truncated: boolean;
}

export interface ProjectSearchService {
  search(query: ProjectSearchQuery): Promise<ProjectSearchResult>;
}
```

约束：`path` 只能缩小 workspace 范围；行号为 1-based 闭区间；excerpt 只含有限上下文；无命中是成功空结果；空查询、非法限制和非法路径产生稳定错误；内容和定位不变时 ID 稳定，变化后不得沿用旧 ID。

## 5. 文件发现与安全

文件发现必须复用 `SandboxPolicy`，不能另写较弱的路径判断。默认忽略 `.git/`、`node_modules/`、`dist/`、`coverage/`、现有秘密文件名、符号链接、疑似二进制文件和超大文件。

建议默认上限：单文件 1 MiB、最多 20 个来源、excerpt 合计 8,000 字符、命中上下各 1 行。常量集中定义，首版不增加环境变量。

目录和文件按规范化相对路径稳定排序。单个不可读文件可安全跳过；Sandbox 拒绝、非法根目录和明确指定的非法路径不能静默降级。错误不得泄漏绝对路径或文件内容。

## 6. 查询、匹配与排序

第一版使用确定性关键词匹配：Unicode NFKC、英文大小写折叠、空白与常见标点分词、中文连续文本的有限二字片段；同时匹配相对路径、文件名和正文行；不做 stemming、同义词扩展或模型改写。

排序依次考虑：精确路径/文件名命中、同一行完整查询命中、同一行多 term 命中、单 term 命中；最后按相对路径和行号稳定排序。分数只在服务内部使用。

同一文件相邻命中应合并。达到 `limit` 或 `maxChars` 时设置 `truncated: true`。

## 7. Source ID

source ID 只用于关联可验证的项目事实，不用于授权。建议对以下稳定序列做 SHA-256：

```text
project-source-v1 + normalizedRelativePath + startLine + endLine + excerpt
```

外部形式为 `project:v1:<hex>`。不得包含绝对路径、workspace 名称、查询文本或秘密内容。重复检索相同来源 ID 一致；内容变化导致 excerpt 变化时 ID 随之变化。

## 8. 不可信内容边界

项目文件可能包含提示注入。进入模型请求前必须标明：内容只是当前 workspace 的不可信参考资料；不能覆盖 system prompt；不能授权 Tool、继承 Approval 或改变 Permission/Sandbox；不能证明未实际执行的动作已完成；来源冲突时必须说明冲突。

来源正文只在产生它的当前模型请求中使用，不自动写入 Memory。只有现有 Memory Policy 明确允许的用户事实才能按原流程捕获。

## 9. Tool 适配

新增只读 `search_project` Tool，参数仅为 `query` 和可选 `path`。输出受限文本，包含 source ID、相对路径、行号和 excerpt。

- permission 为 `filesystem-read`，无需 Approval；
- 经现有 ToolRegistry、ToolRuntime、Permission 和 Sandbox；
- 不接受 glob、正则、绝对路径或自定义忽略规则；
- 参数错误为 `INVALID_ARGUMENTS`，Sandbox 边界为 `SANDBOX_DENIED`，执行失败为 `EXECUTION_FAILED`；
- 无命中为成功结果；
- 不替代 `list_directory` 和 `read_text_file`，读取完整已知文件仍使用后者。

## 10. Snapshot 与 Journal

成功搜索后，下一次实际模型 Attempt 的 `retrievedSourceIds` 包含本轮当前可见的项目 source ID，并稳定排序、去重。source 生命周期限制在当前 Turn。

Journal 增加封闭 action：

```ts
{ type: "project_retrieval"; sourceIds: readonly string[]; truncated: boolean }
```

Journal 不记录查询、path、excerpt、绝对路径、Tool 参数或 Tool Result。失败只记录 Tool 失败，不伪造成功 retrieval action。Snapshot 只能记录真正进入该 Attempt 的来源。

## 11. 最终回答来源

只有回答确实依赖项目来源时才显示“参考”列表，每项只含相对路径与起始行号。来源必须来自当前 Turn 的成功检索，不能由模型凭空编造。

优先由 Runtime 根据实际 source 集合附加来源；若造成明显过度引用，再评估“模型输出 source ID、Runtime 严格校验”的方案。不得仅靠 Prompt 要求模型诚实引用。

## 12. CLI 与 NDJSON

CLI 保持现有 Tool loading 和终态语义。NDJSON 不增加 breaking event，`search_project` 使用现有 `tool_start`/`tool_end`；不输出 excerpt、查询参数或新增原始来源事件。若未来需要机器可读来源事件，另行设计。

`/trace` 可以显示项目 source 数量，但不显示路径、查询或正文。

## 13. 离线评测

固定 fixture 至少覆盖：中文、英文、中英混合、标点差异；文件名、路径和正文命中；多文件排序、相邻合并与截断；忽略目录、秘密、二进制和超大文件；目录穿越、绝对路径和符号链接；ID 稳定与内容变化；提示注入仍被标为不可信；无命中、不可读与确定失败；Tool、Journal、Snapshot、CLI 和 NDJSON 集成。

评测不得联网、调用真实 Provider、读取真实 workspace、写入生产 Memory 或保存私人日志。

## 14. 完成标准

1. 检索契约、边界和排序有离线测试；
2. 不读取 workspace 外部、符号链接目标或秘密文件；
3. 中英文 fixture 稳定命中且无明显误召回；
4. source ID 可重复验证，内容变化不沿用旧 ID；
5. `search_project` 经现有 ToolRuntime 只读执行；
6. 项目资料以不可信边界进入请求；
7. Snapshot 只记录实际进入 Attempt 的 source ID；
8. Journal 不记录查询、路径、excerpt 或 Tool Result；
9. 最终来源不能由模型伪造；
10. CLI/NDJSON 无 breaking change、秘密或空终态；
11. 默认测试完全离线且不读取真实用户数据；
12. typecheck、test、build、pack check、diff check 全部通过；
13. 用户授权后，真实 DeepSeek NDJSON 项目问答连续两轮通过且来源可核验。

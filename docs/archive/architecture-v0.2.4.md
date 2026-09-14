# Isla v0.2.4 架构基线：可评测的项目检索与结构化证据链

## 1. 版本目标

v0.2.3 已经证明 Isla 可以在 workspace 内安全搜索项目文件，并把来源关联到 Model Request Snapshot、Journal 和最终回答。v0.2.4 不扩大到知识库或索引平台，而是修正这条闭环中已经出现的两个薄弱点：

1. `search_project` 的模型展示文本同时承担了 Runtime 内部协议，`ChatSession` 需要用正则从字符串恢复 source ID、路径和行号；
2. 当前离线评测主要证明“能命中”，尚未证明最相关结果稳定排在前面，也没有覆盖完整短语、term 覆盖率和中文片段噪声。

本版建立以下闭环：

1. Tool 的模型可见文本与 Runtime 权威 details 分离；
2. Snapshot、Journal 和来源映射只消费结构化 Tool outcome；
3. 模型可以声明实际引用的 source ID，但 Runtime 只接受当前 Turn 已检索来源；
4. 最终只展示经过验证且确实被回答引用的来源；
5. 项目搜索具有明确、确定性的评分和稳定排序；
6. 用 top-1、top-3、误召回、截断和延迟指标衡量质量；
7. Tool 输出预算优先保留命中行，且只有实际进入模型上下文的来源可被引用。

`StoredSession.messages` 继续是唯一对话正文事实源。Tool details、来源映射、评分、评测报告和 Journal 都不是第二份对话事实源。

## 2. 范围边界

本版包含：最小 `ToolOutput`/`ToolSuccessDetails` 契约；现有字符串 Tool 的兼容归一化；`search_project` 结构化 details；删除来源正则恢复；当前 Turn source allowlist；模型引用标记与 Runtime 校验；确定性相关性评分；中文降级召回；每来源和整体字符预算；扩充离线评测；CLI、NDJSON、Session、Snapshot、Journal 回归。

本版不包含：SQLite/FTS 项目索引、Embedding、向量数据库、文件监听、增量索引、独立 Document Search、跨会话 Session Query、Tool Result spill store、自动查询改写、多查询融合、通用 provenance 框架、Shell、网络、MCP、并行 Tool、后台任务或子 Agent。

不得改变 `StoredSession.messages` 的事实源地位，不得把项目文件自动写入 Memory，不得在 Journal 中记录 query、path、excerpt、Tool 参数或 Tool Result。

## 3. 当前缺口与必须修正的不变量

### 3.1 Tool 展示文本不是内部协议

当前 `ChatSession` 从 `execution.content` 中用正则提取 `project:v1:<sha256>` 和 `path:start-end`。这意味着换行、文案、路径字符或展示格式变化可能静默破坏来源关联。

v0.2.4 冻结以下不变量：

- `content` 只用于模型上下文和用户可理解的 Tool 输出；
- Runtime 权威状态只来自 ToolRuntime 返回的结构化 success details；
- Tool 文本中即使出现格式正确的伪造 source ID，也不能进入 Snapshot、Journal 或最终来源；
- details 不自动进入模型请求、CLI、NDJSON 或持久化正文；
- ToolRuntime 是字符串 Tool 与结构化 Tool 的唯一归一化边界。

### 3.2 “检索到”不等于“回答引用”

当前 Turn 中所有成功检索来源都可能成为最终 `projectSources`。这只能证明模型看过候选资料，不能证明回答依赖了哪些资料。

v0.2.4 将状态分为：

- retrieved：成功 Tool outcome 中、实际进入模型 Tool message 的来源；
- cited：模型最终文本声明引用，且通过当前 Turn allowlist 校验的 retrieved 来源；
- displayed：由 Runtime 将 cited source ID 映射成相对路径和行号后的用户可见来源。

关系必须为 `displayed ⊆ cited ⊆ retrieved`。

### 3.3 排序必须由评分而不是发现顺序决定

文件枚举顺序只能作为最终 tie-break，不能决定相关性。搜索结果必须先生成候选、计算结构化 score，再按 score 和稳定字段排序，最后执行 `limit` 与字符预算。

## 4. DSH 参考与取舍

本版参考 DSH 当前 Tool pipeline、Session Query 和 Tool Result pruning 的设计不变量，不复制其框架。

采用：

- 模型可见 Tool 内容与 host-only 权威结果分离；
- Tool outcome 先规范化，再供审计、投影和最终展示消费；
- 查询结果具有稳定身份、确定性排序和明确失败语义；
- 引用关系必须指向已有权威事实，不能从展示文本反向猜测；
- 超大 Tool Result 应在进入长期上下文压力前受限，并保留最有用部分。

暂缓：

- SQLite Session Query、索引代际、游标和 live/persisted reconciliation；
- append-only Session Event Map、Surface、source event relationship graph；
- Tool Result spill store 和可恢复 locator；
- 通用 Tool middleware、deadline、并发调度和 provenance backend。

拒绝：

- 复制 DSH 源码、目录、Cordis 生命周期或多 package seam；
- 为一个 `search_project` details 需求把全部 Tool 改造成复杂泛型框架；
- 让 DSH 成为 Isla 的构建或运行时依赖；
- 借检索优化提前引入 Shell、网络、MCP、并行 Tool 或子 Agent。

重新评估条件：真实匿名查询评测证明按需扫描加确定性评分仍不能达到质量目标，或基准证明扫描延迟在目标项目规模上不可接受，才讨论 FTS；只有关键词和 FTS 都无法处理已记录的语义漏召回时，才讨论 Embedding。

## 5. Tool 输出契约

### 5.1 最小渐进式契约

建议在 `src/tools/types.ts` 增加：

```ts
export interface ProjectSearchToolSource {
  readonly id: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
}

export interface ProjectSearchToolDetails {
  readonly type: "project_search";
  readonly sources: readonly ProjectSearchToolSource[];
  readonly filesScanned: number;
  readonly truncated: boolean;
}

export type ToolSuccessDetails = ProjectSearchToolDetails;

export interface ToolOutput {
  readonly content: string;
  readonly details?: ToolSuccessDetails;
}

export interface Tool {
  // 现有字段保持不变
  execute(argumentsJson: string): Promise<string | ToolOutput>;
}

export type ToolExecutionResult =
  | {
      readonly ok: true;
      readonly content: string;
      readonly details?: ToolSuccessDetails;
    }
  | ToolExecutionFailure;
```

约束：

- 现有 `list_directory`、`read_text_file`、`write_text_file` 可以继续返回字符串；
- ToolRuntime 将字符串归一化为 `{ ok: true, content }`；
- `search_project` 返回 `{ content, details }`；
- details 使用封闭 discriminated union，不引入 `unknown`/`any` 元数据袋；
- details 中不重复保存 excerpt、query、绝对路径或 Tool 参数；
- `filesScanned` 只用于安全诊断与评测，不进入 Journal；
- failure 结果不得携带伪 success details。

### 5.2 权威来源形成

`search_project` 必须从同一个 `ProjectSearchResult` 同时构造：

- 受限的模型可见 `content`；
- 不含正文的 `ProjectSearchToolDetails`。

details 中的每个 source 必须确实出现在该次模型可见 `content` 中。因 `maxChars`、每来源预算或 `limit` 未进入 content 的候选，不得放进 details。

`ChatSession` 只从 `execution.details?.type === "project_search"` 建立：

- 当前 Turn retrieved source ID set；
- source ID 到 `{ path, startLine, endLine }` 的映射；
- `project_retrieval` Journal action；
- 下一次 Model Attempt 的 `retrievedSourceIds`。

必须删除所有从 `execution.content` 恢复可信 source 的正则或字符串解析。

## 6. 来源生命周期与引用协议

### 6.1 retrieved 生命周期

- 新 Turn 开始时清空 retrieved set、source map 和 cited set；
- 同一 Turn 多次搜索按 source ID 去重；
- 同一 source ID 对应不同定位元数据时 fail closed，不覆盖旧值；
- 失败 Tool、空结果和没有合法 details 的 Tool 不产生 retrieval action；
- Snapshot 只包含在该 Attempt 之前已通过结构化 Tool outcome 进入消息历史的 source ID；
- Session 恢复不自动把旧 Turn 来源恢复为当前 allowlist。

### 6.2 模型引用标记

v0.2.4 使用最小文本协议，不改变 Provider wire contract：

```text
[[source:project:v1:<64 lowercase hex>]]
```

Prompt 规则：当最终回答中的项目事实依赖某个 `search_project` 片段时，在相关句子后输出对应标记；不得引用 Tool 未返回的 ID；普通回答和未依赖项目来源的回答不输出标记。

Runtime 规则：

1. 从最终 assistant text 提取引用声明；
2. 只保留当前 Turn retrieved allowlist 中的 ID；
3. 按首次出现顺序去重，再受统一来源数量上限约束；
4. 从用户可见回答文本中移除所有语法完整的 source 标记，包括未知或伪造 ID；
5. 仅将合法 cited ID 映射为 `ModelResponse.projectSources`；
6. 不把裸 source hash 输出到 CLI、NDJSON 或 `/trace`；
7. 清理标记后若回答只剩空白，按无效模型回答处理，不提交伪 assistant。

解析模型引用声明是对不可信模型输出的校验，不是从展示文本恢复 Runtime 权威事实；权威 allowlist 和定位始终来自 Tool details。

### 6.3 无引用与伪引用

- 检索成功但最终回答没有合法标记：回答可以成功，但不显示“参考”；
- 模型只输出未知标记：移除标记，不显示来源；
- 同一 ID 重复引用：只显示一次；
- 引用上一 Turn ID：视为未知；
- Tool content 中包含伪造 ID：不进入 allowlist；
- 文件在 Tool 返回后发生变化：本轮仍引用实际进入模型请求的不可变片段身份；下一次重新搜索生成新 ID。

## 7. 确定性检索评分

### 7.1 查询归一化

保留 Unicode NFKC 和英文大小写折叠，并明确生成：

- normalized full query；
- 英文/数字 term；
- 连续 CJK segment；
- 仅用于降级召回的 CJK bigram。

空白和常见标点只用于切分，不得让一个空 term 匹配所有内容。相同 term 去重。

### 7.2 候选特征

每个候选 source 至少记录以下布尔或整数特征，不对外暴露浮点 score：

1. `exactPathMatch`；
2. `exactFileNameMatch`；
3. `pathContainsFullQuery`；
4. `fileNameContainsFullQuery`；
5. `lineContainsFullQuery`；
6. `matchedPrimaryTerms`；
7. `totalPrimaryTerms`；
8. `matchedFallbackBigrams`；
9. `distance`，同一片段内多个 term 的最大行距。

建议使用整数评分并集中定义权重。排序优先级必须体现：精确路径/文件名 > 完整查询 > 全部 primary term > 部分 primary term > CJK bigram 降级召回。具体权重可由 Batch A 基线调整，但一旦在架构实施记录中冻结，就必须由测试保护。

最终 tie-break：score 降序、规范化相对路径升序、`startLine` 升序、`endLine` 升序。

### 7.3 中文降级召回

- 两字 CJK 查询按完整查询匹配，不拆成更小单位；
- 三字及以上查询优先完整 segment；
- bigram 仅在没有完整 segment 或 primary term 命中时参与降级召回；
- 只命中一个常见 bigram 的候选不得压过完整短语或全部 primary term 候选；
- fixture 证明降级召回不会把无关文件推入 top-3。

不得在本版引入第三方分词器、同义词表、模型改写、stemming、Embedding 或网络请求。

## 8. 片段形成与输出预算

预算顺序必须是：候选与评分 → 相邻命中合并 → 形成最小命中片段 → 排序 → 分配预算 → 生成 ID 和 Tool output。

约束：

- 保留现有整体 `maxChars` 和 `limit`；
- 新增集中定义的每来源默认字符上限，不增加环境变量；
- 单个长 source 不能耗尽全部整体预算；
- 截断上下文时优先保留实际命中行，再对称减少前后上下文；
- 单个命中行本身超过每来源上限时，进行确定性字符裁剪并设置截断；
- source ID 必须基于实际进入模型 content 的最终 excerpt 和定位，而不是裁剪前候选；
- 整体或任一 source 被裁剪、候选因预算未进入结果时，`truncated` 为 true；
- details 只能列出最终进入 content 的来源。

若实现无法在不改变 source ID 语义的情况下表示“行内字符裁剪”，必须在 Batch F 开始前停止并更新架构，不得静默让 ID 指向无法重建的片段。

## 9. 评测与质量门禁

### 9.1 Fixture 类型

扩展项目搜索评测案例，至少能够表达：

```ts
interface ProjectSearchEvaluationCase {
  readonly name: string;
  readonly query: string;
  readonly path?: string;
  readonly files: readonly EvaluationFile[];
  readonly expectedTop1?: string;
  readonly expectedTop3: readonly string[];
  readonly forbidden: readonly string[];
}
```

既有 `mustInclude`/`mustExclude` 可兼容迁移，但最终必须能断言顺序。

### 9.2 必须覆盖的竞争案例

- 完整短语与单 term 文件竞争；
- 文件名完整命中与正文弱命中竞争；
- 全 term 覆盖与单 term 命中竞争；
- 当前架构文档与历史架构文档竞争；
- 实现文件与只提到名称的测试/fixture 竞争；
- 中文完整短语与单一 bigram 噪声竞争；
- 中英文混合 term；
- 路径范围缩小；
- 多个相同分数结果的稳定 tie-break；
- 单来源过长、整体预算不足和 limit 截断；
- 无结果和全部候选被安全策略排除。

### 9.3 指标与门禁

离线评测至少计算：

- case count；
- top-1 accuracy；
- top-3 recall；
- forbidden result count；
- truncated case count；
- files scanned；
- elapsed time，仅作观察值，不写机器相关的严格毫秒断言。

Batch A 必须先记录当前算法基线，不得为了让基线好看修改 fixture。Batch E 完成后：

- 所有声明 `expectedTop1` 的案例必须 top-1 命中；
- `expectedTop3` 必须全部出现在 top-3；
- forbidden result count 必须为 0；
- v0.2.3 既有安全和命中案例不得回归；
- 相同输入重复运行顺序和 source ID 完全一致。

默认评测只使用虚构临时 workspace，不读取真实 Isla workspace、真实 Session、Memory、`.env` 或日志。

## 10. Snapshot、Journal 与 Session

- `ModelRequestSnapshot.retrievedSourceIds` schema 保持不变；
- request hash 必须继续覆盖实际模型请求，不能把 host-only details 注入模型 messages；
- `project_retrieval` action schema保持不变，只从合法 details 产生；
- action 的 `sourceIds` 与 details 中实际进入模型 content 的 source ID 一致、排序、去重；
- Journal 不新增 cited path、query、excerpt、arguments 或完整 Tool Result；
- 若需要记录 cited 数量，只能在已有安全摘要层派生，本版默认不扩展 Journal；
- Session v1/v2/v3 继续兼容读取；本版不增加 Session v4；
- assistant 历史保存清理引用标记后的最终文本，避免裸 hash 成为对话正文；
- Tool message 仍保存实际发送给模型的 `content`，确保请求可以由会话状态重建。

## 11. CLI 与 NDJSON

- CLI 保留现有“参考”展示，只列合法 cited 来源的相对路径和起始行号；
- 检索成功但未引用时不显示“参考”；
- `/trace` 继续只显示安全数量，不显示 hash、query、path 或 excerpt；
- NDJSON schema 不增加 breaking event；
- `tool_start`/`tool_end` 不输出 details；
- `response_end.text` 不含引用标记或裸 source hash；
- 普通回答、无结果、Provider 失败、Approval、`new_session`、exit/EOF 语义保持不变。

## 12. 安全与隐私

- details 不是授权凭据，source ID 不能绕过 Permission、Approval 或 Sandbox；
- 项目文件继续按不可信参考资料处理；
- 文件中的提示注入、伪 source marker 或伪 Tool 输出不得形成可信引用；
- details 和错误不得包含绝对路径、API Key、秘密文件内容或 query；
- 默认测试不得访问真实 Provider；
- 真实验收必须使用临时虚构 workspace，并在用户明确授权后执行；
- 不增加会把 Tool Result、文件正文或引用 hash 写进普通日志的调试输出。

## 13. 完成标准

1. 现有字符串 Tool 无行为回归，ToolRuntime 可规范化字符串与 `ToolOutput`；
2. `search_project` 返回模型 content 与封闭结构化 details；
3. Runtime 不再解析 Tool content 获取可信来源；
4. 伪造 Tool 文本不能污染 Snapshot、Journal 或最终来源；
5. `displayed ⊆ cited ⊆ retrieved` 有离线测试证明；
6. 未引用、重复引用、未知引用、跨 Turn 引用和空文本均有确定行为；
7. 搜索评分与 tie-break 明确、稳定并通过竞争案例；
8. 中文 bigram 只作降级召回且不压过强匹配；
9. 每来源和整体预算不会让未进入模型的来源进入 details；
10. Snapshot、request hash、Journal 隐私和 Session v1/v2/v3 兼容无回归；
11. CLI/NDJSON 不泄漏 source hash、details、query 或 excerpt；
12. 默认测试完全离线，质量门禁全部通过；
13. typecheck、test、build、pack check、diff check 全部通过；
14. 用户授权后，真实 DeepSeek NDJSON 项目问答连续两轮通过，至少一轮产生合法引用，伪引用和无引用场景行为正确。


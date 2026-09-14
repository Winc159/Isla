# Luna：Isla v0.2.4 可评测项目检索与结构化证据链实施清单

## 1. 唯一架构基线

以 `docs/architecture-v0.2.4.md` 为唯一 v0.2.4 架构基线。开始前完整阅读：

1. 根目录 `AGENTS.md`；
2. `docs/architecture-v0.2.4.md`；
3. `docs/architecture-v0.2.3.md`；
4. `docs/luna-implementation-v0.2.4.md`；
5. `docs/dsh-reference-review.md`；
6. `docs/evaluation-v0.2.3.md`。

如果实现需要改变核心契约、引用语法、source ID 语义、Session schema 或范围边界，立即停止，先与用户确认并同步架构文档。不得用“实现方便”为理由静默偏离。

## 2. 全程执行约束

- 先运行 `git status --short` 并记录现有修改；用户已有修改全部保留；
- 未经用户明确要求，不执行 `git add`、`git commit`、`git push`、rebase、reset、checkout 或其他 Git 写操作；
- 每次只实施一个 Batch；专项测试和 typecheck 通过后停止并汇报，等待继续指令；
- `StoredSession.messages` 始终是唯一对话正文事实源；
- 默认测试完全离线，不读取真实 Session、Memory、`.env`、日志或 Isla workspace 内容；
- 不发送真实 Provider 请求，除非进入 Batch I 且用户明确授权；
- 不改变 Approval、Permission、Sandbox、Provider 或 NDJSON 现有语义；
- 不增加 FTS、Embedding、文件监听、Document Search、Shell、网络、MCP、并行 Tool、后台任务或子 Agent；
- 不创建通用元数据袋、事件总线、middleware 框架或 DSH 兼容层；
- 不能通过降低测试断言、删除 fixture 或扩大忽略范围掩盖质量问题。

## 3. 实施前代码审计

编码前必须读取并记录关键事实：

1. `src/tools/types.ts`：`Tool.execute()` 与 `ToolExecutionResult` 当前只有字符串成功结果；
2. `src/tools/runtime.ts`：成功结果的唯一归一化位置；
3. `src/tools/search-project.ts`：同一字符串承载模型文本与来源字段；
4. `src/project-search/search.ts`：当前按发现顺序遍历、term OR 匹配和 source ID 形成位置；
5. `src/project-search/discovery.ts`：Sandbox、忽略、秘密、symlink、二进制和大小限制；
6. `src/core/session.ts`：当前 source ID/路径正则、Turn 生命周期、Tool message、最终 `ModelResponse`；
7. `src/core/request-snapshot.ts`：`retrievedSourceIds` 和 request hash；
8. `src/core/journal.ts`：`project_retrieval` 与 Tool action；
9. `src/prompts/`：Tool loop 和最终回答规则的装配位置；
10. `src/cli.ts`、`src/protocol/`、`src/cli/trace-command.ts`：来源展示和机器协议；
11. 所有 project-search、tool-runtime、session、snapshot、journal、CLI、protocol 测试；
12. `tests/protocol.e2e.test.ts` 是否存在用户未提交修改，禁止覆盖。

审计输出必须指出：现有正则所在行、字符串 Tool 数量、当前排序实际行为、当前引用展示触发条件、当前全量测试基线。只读审计不修改代码。

## 4. Batch A：冻结质量与行为基线

目标：先证明当前方案在哪里不足，不修改生产搜索或 Tool 行为。

允许修改：

- `tests/fixtures/project-search-cases.ts`；
- `tests/project-search-evaluation.test.ts`；
- 必要的新 evaluation helper 测试文件；
- 新建 `docs/evaluation-v0.2.4.md`，只记录基线。

任务：

1. 扩展 fixture schema，使案例能够表达 `expectedTop1`、`expectedTop3`、`forbidden` 和可选 `path`；
2. 兼容迁移现有三个案例，不删除既有断言；
3. 新增至少十个竞争案例，覆盖架构第 9.2 节；
4. 增加纯函数式指标汇总：case count、top-1、top-3、forbidden、truncated、files scanned、elapsed；
5. elapsed 只记录观察值，不设置依赖机器速度的硬阈值；
6. 在 `docs/evaluation-v0.2.4.md` 记录当前算法实际结果和已知失败案例；
7. 基线测试允许明确记录预期的当前弱点，但测试套件本身必须通过；不得把错误排序写成最终正确标准。

建议方式：把“当前观察指标”和“最终质量门禁”分开；Batch A 对指标计算与 fixture 正确性做硬断言，最终 top-k 门禁在 Batch E 启用。

专项验证：

```text
npx vitest run tests/project-search-evaluation.test.ts
npm run typecheck
```

硬失败：读取真实 workspace；为了通过而构造没有竞争项的 fixture；修改 `src/`；用严格毫秒阈值制造平台不稳定；把当前错误顺序永久固化为目标。

停点：提交基线指标、失败案例清单和测试结果，停止。

## 5. Batch B：最小结构化 ToolOutput

目标：建立渐进兼容的 Tool 成功结果，不触碰来源生命周期。

允许修改：

- `src/tools/types.ts`；
- `src/tools/runtime.ts`；
- `src/tools/search-project.ts`；
- 对应 Tool/ToolRuntime 测试。

任务：

1. 按架构第 5 节增加 `ProjectSearchToolSource`、`ProjectSearchToolDetails`、封闭 `ToolSuccessDetails` 和 `ToolOutput`；
2. `Tool.execute()` 接受 `Promise<string | ToolOutput>`；
3. ToolRuntime 将字符串规范化为原有 `{ ok: true, content }`；
4. ToolRuntime 将结构化输出规范化为 `{ ok: true, content, details }`；
5. 拒绝错误 details discriminant，且 failure 不得携带 details；保持现有字符串 `content` 的成功/失败语义，不在本批顺手增加新的通用内容校验；
6. `search_project` 从同一个 Search Result 生成 content 与 details；
7. details 只包含最终出现在 content 中的 id、相对路径、起止行、filesScanned、truncated；
8. 其他三个文件 Tool 保持字符串返回，不批量重写；
9. 本批不得修改 `session.ts`，现有正则暂时仍工作。

测试必须证明：

- 每个旧字符串 Tool 行为不变；
- 结构化输出被保留；
- details 不进入 content；
- search details 与 content source 集合一一对应；
- 空结果的 details sources 为空；
- details 无 excerpt、query、绝对路径或 arguments；
- Tool failure 不携带旧的 success details。

专项验证：

```text
npx vitest run tests/core/tool-runtime.test.ts tests/tools/search-project.test.ts tests/core/tools.test.ts
npm run typecheck
```

硬失败：引入 `Record<string, unknown>`/`any` 元数据袋；要求所有 Tool 立即结构化重写；把 details 序列化进模型 content、NDJSON 或 Journal；改变 Approval/Sandbox。

停点：报告契约 diff、兼容测试和隐私断言，停止。

## 6. Batch C：结构化来源成为唯一权威入口

目标：删除从 Tool 展示文本恢复可信来源的逻辑。

允许修改：

- `src/core/session.ts`；
- 必要的 core 类型；
- project-search session、source display、snapshot、journal 测试。

任务：

1. `ChatSession` 只处理 `execution.details?.type === "project_search"`；
2. 用 details 建立 retrieved set 和 source map；
3. details 中重复 ID 必须去重；同 ID 不一致定位必须 fail closed，并产生安全 Tool failure 或阻断，不得覆盖；
4. `project_retrieval` action 只由合法 details 产生；
5. 下一 Model Attempt 的 `retrievedSourceIds` 只来自合法 details；
6. 新 Turn 清空 set 和 map；
7. 删除 `execution.content.matchAll(...)` 及所有等价来源正则；
8. Tool message 仍追加原始 `content`，保证请求可重建；
9. 暂时保持现有“检索后全部来源可展示”的外部行为，引用收紧留给 Batch D。

必须增加攻击性测试：

- 普通 Tool content 中伪造合法 `project:v1:` ID；
- `search_project` content 含伪 ID但 details 为空；
- details 有来源但 content 没有对应来源；
- 同 ID 不同路径/行号；
- 失败结果附带伪字段；
- 跨 Turn 和 Session restore 后旧 ID 不进入新 allowlist。

对于“details 有来源但 content 没有对应来源”，优先在 `search_project` 生产边界保证不可形成；如果 core 仍需防御，使用结构化一致性字段或精确 ID presence 校验只能作为防御检查，不能从 content 恢复路径、行号或新增来源。

专项验证：

```text
npx vitest run tests/core/project-search-session.test.ts tests/core/request-snapshot.test.ts tests/core/journal.test.ts tests/core/project-source-display.test.ts
npm run typecheck
```

硬失败：保留正则作为 fallback；从 content 恢复任意可信路径或 ID；Journal 写入 details、query、path、excerpt 或 Tool Result；增加 Session v4。

停点：提供代码搜索结果证明可信来源正则已删除，并报告专项测试，停止。

## 7. Batch D：严格引用声明与最终来源

目标：实现 `displayed ⊆ cited ⊆ retrieved`。

允许修改：

- `src/core/session.ts` 或一个单独的轻量 citation helper；
- `src/prompts/` 中 Tool loop/final 指引；
- `src/core/types.ts` 必要的非 breaking 类型；
- CLI/source display 和 FakeProvider 测试。

任务：

1. 实现架构规定的 `[[source:project:v1:<64 lowercase hex>]]` 解析；
2. parser 必须是小型纯函数，并有独立测试；不得建设通用 citation framework；
3. 从最终模型文本提取声明，只接受当前 Turn retrieved allowlist；
4. 按首次出现顺序去重并应用现有来源数量上限；
5. 从最终用户文本中移除所有语法完整的 source marker，包括未知 ID；
6. 只为合法 cited ID 生成 `ModelResponse.projectSources`；
7. assistant message 保存清理后的文本；
8. 清理后为空时走现有无效回答/Provider failure 语义，不提交 assistant；
9. Prompt 只说明何时和如何引用，不宣称 marker 可以授权动作；
10. `/trace` 和 NDJSON 不增加 hash 输出。

测试矩阵：

- 单个合法引用；
- 同句多个合法引用；
- 重复引用；
- 未知 ID；
- 上一 Turn ID；
- 大写 hex、长度错误、嵌套或残缺 marker；
- 只有 marker、marker 前后空白；
- 检索成功但回答无引用；
- 普通回答包含类似但非完整语法文本；
- 最终 CLI 只显示路径与起始行；
- NDJSON `response_end.text` 无 marker/hash；
- Session assistant 正文无 marker/hash；
- request snapshot 中此前 Tool content 保持可重建。

专项验证：

```text
npx vitest run tests/core/project-source-display.test.ts tests/core/project-search-session.test.ts tests/cli.test.ts tests/protocol.test.ts tests/protocol.e2e.test.ts
npm run typecheck
```

硬失败：把模型 marker 当作权威来源；合法性不依赖当前 Turn allowlist；无引用仍展示全部 retrieved 来源；把 source hash 留在 assistant 正文或 NDJSON；改变 Provider wire schema。

停点：展示五类引用测试结果和实际清理后的示例，停止。

## 8. Batch E：确定性评分与最终质量门禁

目标：让相关性决定顺序，而不是文件发现顺序。

允许修改：

- `src/project-search/search.ts`；
- 必要的 project-search 内部类型；
- project-search 测试和 Batch A 评测门禁；
- `docs/evaluation-v0.2.4.md` 指标记录。

任务：

1. 将搜索拆成清晰但不过度分层的三个内部步骤：query normalization、candidate collection/scoring、stable ranking；
2. 实现架构第 7.2 节全部候选特征；
3. 使用集中定义、带名称的整数权重；禁止散落 magic number；
4. 完整路径/文件名、完整 query、primary term coverage 和 fallback bigram 必须严格分层；
5. bigram 只在强匹配不足时降级召回；
6. 合并相邻命中后重新确定 source 范围，不因 term 数量重复产生 source；
7. 最终以 score、path、startLine、endLine 稳定排序；
8. 启用 Batch A 的最终 top-1/top-3/forbidden 硬门禁；
9. 更新 evaluation 文档，保留 Batch A 基线并追加改进后指标，不覆盖历史值。

测试必须证明：

- 文件创建顺序变化不改变结果；
- 完整短语压过单 term；
- 文件名强命中压过正文弱命中；
- 全 term 覆盖压过部分覆盖；
- 中文完整短语压过单 bigram；
- 相同 score 使用稳定 tie-break；
- 相同输入重复运行 source ID 和顺序一致；
- v0.2.3 安全、路径、截断和 source ID 测试无回归。

专项验证：

```text
npx vitest run tests/project-search.test.ts tests/project-search-evaluation.test.ts tests/project-search-types.test.ts tests/project-search-discovery.test.ts
npm run typecheck
```

硬失败：为单个 fixture 写路径特判；引入第三方分词/搜索库、FTS、Embedding 或模型调用；使用不稳定浮点比较；修改安全发现规则来提高指标；降低最终门禁。

停点：报告基线与新指标对比、权重表和专项测试，停止。

## 9. Batch F：每来源预算与可重建截断

目标：防止单一长来源耗尽整体上下文，并确保 details 精确描述实际模型输入。

允许修改：

- `src/project-search/types.ts`；
- `src/project-search/search.ts`；
- `src/tools/search-project.ts`；
- 对应测试与 evaluation 文档。

任务：

1. 增加集中定义的每来源默认字符上限，不增加环境变量或 Tool 参数；
2. 排序完成后再分配整体和每来源预算；
3. 截断时先减少上下文行，保留所有实际命中行；
4. 单个命中行仍过长时，设计确定性、可重建的行内截断表示；
5. 如果行内截断需要扩展 source 定位契约，停止并先请求用户确认，不得私自改变 source ID v1；
6. source ID 对实际进入 content 的最终 excerpt 计算；
7. 未进入 content 的候选不进入 details、retrieved set、Snapshot 或引用 allowlist；
8. 任一裁剪或预算淘汰使 `truncated` 为 true；
9. 多个短来源在总预算内应公平进入，不得被首个长来源饿死。

测试矩阵：长上下文、多命中行、单行超长、首来源超长、多短来源、整体刚好等于上限、少一字符/多一字符、limit 与 maxChars 同时触发、CRLF/LF、一致 source ID。

专项验证：

```text
npx vitest run tests/project-search.test.ts tests/project-search-evaluation.test.ts tests/tools/search-project.test.ts tests/core/project-search-session.test.ts
npm run typecheck
```

硬失败：source ID 基于未进入模型的原文；details 包含被预算排除来源；截断删除命中本身却保留无关上下文；静默改变 `project:v1` 身份语义。

停点：报告预算常量、边界案例和是否遇到 source ID 契约阻断，停止。

## 10. Batch G：Session、Journal、CLI 与 NDJSON 全链路回归

目标：证明新证据链没有破坏 v0.2.3 的可靠性与正式协议。

任务：

1. Session v1/v2/v3 fixture 全部兼容；
2. Tool content 保持在 messages 中，host-only details 不持久化为正文；
3. Snapshot request hash 与实际请求一致；
4. Journal 只保存安全 source ID 和 truncated；
5. 失败、retry、interrupted Turn 不产生伪引用；
6. CLI 只显示合法 cited path/line；
7. `/trace` 只显示安全计数；
8. NDJSON 沿用现有 schema 和终态；
9. Memory candidate、recall 和 compaction 不吸收 marker/hash/details；
10. 更新 README 中 v0.2.4 用户行为说明，但不暴露内部 marker 作为用户 API。

专项验证至少覆盖：

```text
npx vitest run tests/session-store.test.ts tests/session-store-v3.test.ts tests/core tests/cli tests/protocol.test.ts tests/protocol.e2e.test.ts tests/memory
npm run typecheck
```

硬失败：Session 升级到 v4；Journal/trace/NDJSON 泄漏 query、excerpt、details 或 hash；失败后保存伪 assistant；改变 Approval、Sandbox 或普通 Tool 行为。

停点：全链路专项测试通过后停止。

## 11. Batch H：离线收口与文档

目标：完成全部离线门禁，形成可审计交付记录。

任务：

1. 完成 `docs/evaluation-v0.2.4.md`，记录每批结果、基线/最终指标和未解决项；
2. 更新 `README.md`、`docs/roadmap.md`、`docs/references.md`、`docs/dsh-reference-review.md`、必要的 `docs/bugs.md`；
3. 明确记录 FTS、Embedding、Session Query、spill store 继续暂缓的原因和重新评估条件；
4. 检查源码、fixture、快照、构建产物和文档无真实秘密或私人内容；
5. 运行最终离线门禁：

```text
npm run typecheck
npm test
npm run build
npm run pack:check
git diff --check
```

6. 记录测试文件数、通过/跳过数、构建结果、pack 内容摘要和 Git 状态；
7. 不宣布真实 Provider 已验收；等待用户是否授权 Batch I。

硬失败：跳过失败测试仍宣布完成；打包真实 `.env`、数据库、Session 或日志；使用真实 API；执行 Git 写操作。

停点：提交离线收口报告并等待真实验收授权。

## 12. Batch I：真实 DeepSeek NDJSON 验收

仅在用户明确授权产生真实请求和可能费用后执行。

环境：使用临时虚构 workspace；不得搜索真实 Isla 项目、真实 Session、Memory 或私人目录；日志只保留安全 NDJSON 事件，最终清理临时正文和会话。

至少验证：

1. 连续两轮项目问答均成功；
2. 第一轮强制 `search_project`，回答包含至少一个合法 source marker，最终 CLI/NDJSON 文本已清理 marker，用户来源路径/行号正确；
3. 第二轮查询不同事实，上一 Turn source 不能被引用；
4. 无结果时模型不编造来源；
5. fixture 文件内的伪 source marker 不进入可信来源；
6. 普通回答不显示参考；
7. Provider timeout/retry 不生成伪 assistant 或伪引用；
8. `new_session` 后旧 allowlist 清空；
9. exit/bye 无空终态；
10. Session、Journal 和安全日志不包含 API Key、query、excerpt、details 或裸 source hash；会话正文中的 Tool content 按既有隐私边界处理，不将私人 workspace 用于验收。

失败必须归类为：检索评分、Tool details、引用 Prompt、引用校验、Provider、Persistence 或 NDJSON。不得增加无界 retry、放宽 allowlist 或降低测试来掩盖失败。

完成后更新 `docs/evaluation-v0.2.4.md`，记录模型、场景、耗时、成功/失败分类和清理情况，不记录真实回答正文或秘密。

## 13. 最终完成判定

只有以下全部满足，才可宣布 v0.2.4 完成：

1. 架构第 13 节全部完成标准有代码或测试证据；
2. Batch A–H 均按顺序完成且每批有停点记录；
3. 最终离线门禁全部通过；
4. 若用户授权真实验收，Batch I 通过；若未授权，必须明确标为“离线实现完成，真实 Provider 待授权”，不能写成完全完成；
5. 没有覆盖用户原有修改；
6. 没有执行 Git add、commit 或 push；
7. 交付摘要列出改动文件、测试数量、已知限制和下一重新评估条件。

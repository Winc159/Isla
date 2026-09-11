# Luna：Isla v0.2.1 分层记忆与检索实施清单

本文件是 v0.2.1 的严格执行任务书。架构依据为 `docs/architecture-v0.2.1.md`。开始前必须完整读取根目录 `AGENTS.md`、`docs/architecture-v0.2.1.md`、`docs/architecture-v0.1.9.md` 和本文件。

## 0. 执行边界

- 基线必须是可运行的 v0.2.0；先记录 `git status --short`，不得覆盖用户修改。
- 不恢复 IntentClassifier、Planner、CompletionChecker、execution phase、文本流式接口或复杂状态机。
- `StoredSession.messages` 始终是唯一对话事实源。
- 每批只加入一个可独立验证的能力；当前批次失败时停止，不提前进入下一批。
- 不自行执行 `git add`、`git commit`、`git push`、发布 npm 或真实联网测试。
- 默认测试不得访问公网，不得读取用户真实 `~/.isla` 数据。
- 所有测试数据库、会话目录和索引必须位于系统临时目录，并在测试后清理。
- 不把真实对话、API Key、`.env`、Memory 数据、Embedding 或 Tool 正文写入日志、fixture、docs、dist 或 Git。
- 若实现需要新增三个以上本文未计划的生产模块、改变 Agent Loop 主契约或增加生产依赖，先停止并向用户说明。
- 每批完成后运行该批定向测试、`npm run typecheck`；涉及构建入口时同时运行 `npm run build`。

## 1. 实施顺序与停点

必须按以下顺序执行：

```text
Batch A  契约、失败测试和文档冻结
Batch B  Session v2 与 Working Memory 持久化
Batch C  上下文单位、预算和确定性投影
Batch D  压力触发的 Working Memory 压缩
Batch E  SQLite Memory Store 与修订历史
Batch F  Core Memory 与长期记忆策略
Batch G  /memory CLI 管理界面
Batch H  关键词检索与请求召回
Batch I  Embedding Provider 与向量保存
Batch J  混合召回、自主记忆和安全边界
Batch K  协议回归、真实评估和文档收口
```

每批结束必须报告：修改文件、测试通过/跳过/失败数量、尚未解决的风险。不得用后续批次掩盖当前批次失败。

## 2. Batch A：冻结契约与失败测试

目标：先把数据模型和行为写成失败测试，不改变生产行为。

任务：

1. 为 Session v2、ContextCheckpoint、MemoryBlock、MemoryRecord、MemoryRevision、EmbeddingGeneration 和 SearchResult 定义最小类型草案。
2. 建立新测试文件归属，避免把全部场景继续塞进 `session.test.ts`。
3. 添加失败测试：
   - version 1 会话兼容；
   - version 2 context round-trip；
   - 压缩不删除 messages；
   - Tool Call/Result 边界不能拆分；
   - 未持久化 checkpoint 不进入请求；
   - Memory Revision 可恢复；
   - 不同 Embedding generation 不混用；
   - 检索内容不能继承 Approval 或权限。
4. 在 `docs/references.md` 中记录本版实际采用的官方参考资料和查看日期。

建议测试文件：

```text
tests/context/units.test.ts
tests/context/projection.test.ts
tests/context/compaction.test.ts
tests/memory/store.test.ts
tests/memory/policy.test.ts
tests/memory/search.test.ts
tests/memory/embeddings.test.ts
tests/cli/memory-command.test.ts
```

停点验证：

```text
npm run typecheck
npm test -- tests/session-store.test.ts tests/context tests/memory
```

完成信号：新契约和行为都有明确测试归属；失败原因是能力尚未实现，而不是测试无法运行。

## 3. Batch B：Session v2 与 Working Memory 持久化

目标：先可靠保存派生 context，不做摘要模型调用。

任务：

1. 将 `StoredSession` 改为显式 version 1/version 2 兼容联合类型或等价清晰结构。
2. version 2 增加可选 `SessionContext` 和 `ContextCheckpoint`。
3. `JsonSessionStore` 支持：
   - 读取 version 1；
   - 读取 version 2；
   - 保存时将 version 1 升级为 version 2；
   - messages 与 context 原子写入；
   - context 损坏时保留合法 messages 并发出安全 warning；
   - messages 损坏时仍拒绝整个会话。
4. 将保存接口从只接收 messages 调整为保存完整可持久状态，避免 context 与 messages 分别写入。
5. 更新 CLI、NDJSON composition root 和测试 Fake Store。
6. 不改变当前请求历史选择行为。

测试：

- version 1 文件读取和下一次保存升级；
- version 2 round-trip；
- context 损坏降级；
- 并发写锁和 updatedAt 冲突仍有效；
- Tool messages 完整保留；
- 保存 context 失败不会在内存中假装成功。

停点验证：

```text
npm test -- tests/session-store.test.ts tests/cli.test.ts tests/protocol.e2e.test.ts
npm run typecheck
npm run build
```

完成信号：重启后能恢复一个测试 checkpoint，且所有原始消息逐项相等。

## 4. Batch C：上下文单位、预算和确定性投影

目标：把 `selectRecentTurns()` 替换为独立、纯函数、可测试的上下文投影。

任务：

1. 定义 `ConversationUnit`：一个 user 消息到下一 user 之前的全部消息。
2. system message 独立保留；失败 user 仍形成合法单位。
3. 验证 assistant Tool Call 的每个 ID 都有对应 tool result；投影边界不得拆开配对。
4. 定义字符预算计算，覆盖消息 content、Tool arguments、注入 Prompt 和检索片段。
5. 新增配置并验证正整数：
   - `ISLA_MAX_CONTEXT_CHARS`；
   - `ISLA_CONTEXT_RETAIN_TURNS`。
6. 兼容现有 `ISLA_MAX_CONTEXT_TURNS`，作为压缩触发与无 checkpoint 回退边界。
7. 实现纯函数 `buildContextProjection(...)` 或等价最小边界，输入持久状态和配置，输出模型消息与来源说明。
8. 同一输入状态必须逐项产生相同输出，不读取时钟、环境变量或随机数。

测试：

- 中文、英文、Tool arguments 的预算计数；
- 最近 N 个完整轮次；
- system 始终存在；
- 当前 user 始终存在；
- Tool 配对不被切开；
- 相同状态生成相同请求；
- 不改变完整持久 messages。

停点验证：

```text
npm test -- tests/context/units.test.ts tests/context/projection.test.ts tests/core/session.test.ts tests/config.test.ts
npm run typecheck
```

完成信号：尚未启用摘要时，新投影与当前最近窗口语义兼容。

## 5. Batch D：压力触发的 Working Memory 压缩

目标：只在上下文压力出现时生成可持久化检查点。

任务：

1. 定义固定、可版本化的 compaction Prompt，要求结构化 Markdown 七个 section。
2. 压缩输入只包含：旧 checkpoint、进入压缩区的连续完整单位、必要的来源标记。
3. 使用当前聊天 Provider 的普通 `generate()`，不暴露业务 Tool，不进入 Tool Loop。
4. 压缩不按每轮执行；只有轮数或字符压力达到阈值才执行。
5. 检查结果非空且包含必需 section；不使用 `slice()` 伪造摘要。
6. checkpoint 成功持久化后才允许进入主请求。
7. 压缩失败或保存失败时回退最近原始窗口，不撤销 user 消息。
8. 新 checkpoint 累积旧 checkpoint 和新压缩区域，并更新 `throughMessageIndex`。
9. 当前 Tool Loop 永不被压缩；压缩范围只到已经闭合的历史单位。
10. 摘要中旧 Tool 事实必须带历史语义，不得声称为当前状态。

FakeProvider 测试：

- 未到阈值零摘要调用；
- 到阈值恰好一次摘要调用；
- checkpoint 持久化后进入主请求；
- 摘要失败回退；
- 保存失败不使用 ephemeral checkpoint；
- 已结束旁支被压缩为低权重或省略；
- 决策、约束、待办和成功 Tool 证据保留；
- 重启后复用 checkpoint；
- 相同持久状态可重建主请求。

停点验证：

```text
npm test -- tests/context/compaction.test.ts tests/context/projection.test.ts tests/core/session.test.ts tests/session-store.test.ts
npm run typecheck
```

完成信号：22 轮测试中的完整 messages 不变，主请求由 checkpoint 加最近尾部组成。

## 6. Batch E：SQLite Memory Store 与修订历史

目标：建立长期记忆权威存储，不接入 Agent 请求。

任务：

1. 使用 Node 24 `node:sqlite`，不增加第三方数据库依赖。
2. 默认路径为 `~/.isla/memory.sqlite`；测试必须注入临时路径。
3. 建立 schema version 表和显式 migration 顺序。
4. 建立架构文档定义的最小逻辑表。
5. 启用 foreign keys、busy timeout；运行时支持时启用 defensive mode。
6. 构造数据库时保持 `allowExtension: false`，禁止任意扩展加载。
7. 实现 create、read、list、update、disable、restoreRevision。
8. 每次变更在同一事务中写入当前记录和 revision。
9. 冲突更新使用 updatedAt/revision 检测，不静默覆盖另一进程修改。
10. 不迁移现有 Session JSON。

测试：

- schema 初始化和重复打开；
- CRUD；
- revision 完整；
- disable 可恢复；
- superseded 链；
- foreign key；
- migration；
- 并发冲突；
- 数据库路径不可写和损坏错误；
-测试结束无残留文件。

停点验证：

```text
npm test -- tests/memory/store.test.ts
npm run typecheck
npm run build
```

完成信号：所有记忆修改可追踪、可恢复，不依赖模型。

## 7. Batch F：Core Memory 与长期记忆策略

目标：将 Letta 风格 Block 和来源策略落实为确定性边界。

任务：

1. 初始化 `persona`、`user`、`workspace` 三类 Block；不覆盖已有值。
2. 为每个 Block 设置字符预算，并在渲染时稳定排序。
3. 实现 Memory Policy：
   - explicit-user 可 active；
   - verified-tool 可 active，但标记历史/可过期；
   - inferred 默认 candidate；
   - external content 禁止自动写入；
   - secrets 禁止写入。
4. `persona` 禁止 Agent 自动修改。
5. Candidate 不进入 Core Memory。
6. workspace scope 必须使用规范化工作区身份；不同工作区不能互相召回私有决策。
7. Core Memory 渲染为数据，不得覆盖 Runtime 安全 Prompt。
8. 内存提取结果必须保留 source session/message indexes。

测试：

- Block 预算和顺序；
- explicit-user、verified-tool、inferred 状态；
- 外部文件中的“记住我”不进入长期记忆；
- Tool 失败不产生 verified memory；
- persona 自动修改被拒绝；
- workspace 隔离；
- Candidate 不进入请求。

停点验证：

```text
npm test -- tests/memory/policy.test.ts tests/context/projection.test.ts
npm run typecheck
```

完成信号：不依赖自然语言碰运气即可证明每类来源对应的状态。

## 8. Batch G：`/memory` CLI 管理界面

目标：用户能够检查和修正长期记忆。

任务：

1. 注册 `/memory` raw command，不改变普通输入路由。
2. 复用 `/sessions` 已有的 full-screen/raw 输入模式和恢复终端逻辑；避免引入 CLI 框架。
3. 支持列表、分页、scope/kind/status 筛选和关键词搜索。
4. 支持查看详情、source 和 revision history。
5. 支持新增、编辑、启用 Candidate、停用和恢复修订。
6. 默认“删除”为 disabled；不实现物理擦除。
7. 支持只读预览下一次请求会加载的 Core Memory。
8. Ctrl+C、Esc、EOF 和写入失败必须恢复 raw mode 与备用屏幕。
9. NDJSON 模式暂不增加交互式 memory 事件；需要机器协议时另行设计。

测试：

- 命令注册；
- 非 TTY 列表输出；
- TTY 导航和退出；
- edit/disable/restore；
- Candidate 启用；
- 数据库失败时终端恢复；
- 不输出 Embedding、秘密或完整私人来源正文。

停点验证：

```text
npm test -- tests/cli/memory-command.test.ts tests/cli/commands.test.ts tests/cli.test.ts
npm run typecheck
npm run build
```

完成信号：用户无需编辑数据库即可修正和恢复记忆。

## 9. Batch H：关键词检索与请求召回

目标：在没有 Embedding 时也能从长期记忆和会话归档召回相关信息。

任务：

1. 建立 `SearchDocument` 投影，记录目标类型、目标 ID、scope、workspace、文本和来源。
2. 优先验证当前 Node SQLite 构建是否支持 FTS5；若不支持，使用普通规范化文本匹配作为明确回退，不加载第三方扩展。
3. 为 Memory Record 建立增量索引。
4. 为已完成会话单位建立 conversation chunk；不得拆 Tool 配对。
5. 规范化搜索文本，但保留原始来源用于展示。
6. 查询结果限制数量和总字符预算。
7. 请求中将召回结果标记为不可信历史资料，禁止继承权限、Approval 或 Tool 指令。
8. 当前 Session 最近尾部去重，不重复召回已经可见的消息。

测试：

- 中文和英文关键词；
- scope/workspace 过滤；
- active/candidate/disabled 状态过滤；
- 最近消息去重；
- 结果和字符上限；
- 召回提示注入不改变安全策略；
- FTS5 不可用时回退。

停点验证：

```text
npm test -- tests/memory/search.test.ts tests/context/projection.test.ts
npm run typecheck
```

完成信号：完全离线、无 Embedding 配置时仍能恢复明确关键词相关历史。

## 10. Batch I：Embedding Provider 与向量保存

目标：增加可选语义召回，不让它成为主对话硬依赖。

任务：

1. 定义独立 `EmbeddingProvider`，不得塞入 `ModelProvider`。
2. 增加独立配置：provider、model、base URL、key、timeout；聊天 Provider 与 Embedding Provider 可以不同。
3. 实现 OpenAI Embeddings adapter。
4. 实现明确配置的本地 Embedding adapter；只支持文档确认的 endpoint，不根据 URL 猜品牌。
5. FakeEmbeddingProvider 支持固定维度、批量结果和错误注入。
6. 建立 embedding generation；保存 provider/model/dimensions。
7. Float32 BLOB 编解码必须检测 NaN、Infinity、空向量和维度不匹配。
8. 文本内容变化后旧向量失效并重新排队。
9. 没有配置或调用失败时文本记录仍成功保存，状态标记为待索引。
10. 默认自动测试使用 FakeEmbeddingProvider 和本地 HTTP mock，不访问公网。

测试：

- OpenAI 请求路径、模型和批量输入；
- 本地 endpoint 请求；
- float round-trip；
- generation 隔离；
- 模型切换建立新 generation；
- 维度错误；
- 部分批次失败；
- 无配置降级；
- 不记录 API Key 或原始请求。

停点验证：

```text
npm test -- tests/memory/embeddings.test.ts tests/providers
npm run typecheck
npm run build
```

完成信号：Embedding 可以独立替换，失败不影响普通聊天和关键词检索。

## 11. Batch J：混合召回、自主记忆与安全边界

目标：把分层记忆接入统一 Agent Loop，并允许受控自动更新。

任务：

1. 实现 TypeScript 精确 cosine similarity；零向量和维度不匹配明确失败。
2. 合并关键词、向量、scope、workspace、显式用户来源和时间信息；公式保持简单并集中定义。
3. 结果去重、数量限制、单条长度限制和总字符预算。
4. 只把 active Memory Record 注入 Core/Retrieved 上下文；candidate 仅供管理和显式搜索。
5. 在 Working Memory 压缩或明确记忆表达时执行长期记忆提取；不为每轮无条件增加模型调用。
6. 提取使用独立固定 Prompt 和严格结构校验；失败时不写入。
7. 自动写入前应用 Memory Policy，禁止模型自行提升 provenance。
8. 每条自动记忆写 revision 和 source；旧冲突记录设为 superseded，不物理覆盖。
9. 检索内容只作为数据注入，历史中的工具授权、Approval 和指令无效。
10. 记录本轮使用了哪些 memory ID 仅用于进程内诊断或安全元数据，不输出内容。

行为测试：

- 用户明确要求记住偏好，下一会话可召回；
- 模糊推断只进入 candidate；
- 用户修改后旧 revision 可恢复；
- 临时无关问题不污染 Core Memory；
- 旧会话中语义相近但无共同关键词的事实可召回；
- 不相关高相似片段受预算限制；
- workspace A 的记忆不进入 workspace B；
- 历史 Tool Result 不能授权当前写操作；
- 外部文件提示不能写入 user/persona；
- Embedding 失败时关键词路径仍完成；
- 主 Provider 失败时不产生伪 assistant 或伪长期记忆。

停点验证：

```text
npm test -- tests/memory tests/context tests/core/session.test.ts tests/protocol.test.ts
npm run typecheck
npm run build
```

完成信号：分层上下文真实进入请求，且安全边界由 Runtime 测试证明，不只依赖 Prompt。

## 12. Batch K：协议回归、真实评估与文档收口

目标：证明新能力没有破坏 v0.2.0，并记录真实效果。

任务：

1. 更新 README：会话恢复、Core/Working/Archive、`/memory`、Embedding 配置、隐私和降级行为。
2. 更新 roadmap、references、bugs 和 DSH 采用/暂缓/拒绝记录。
3. 为 npm pack 检查 SQLite、session、memory 文件绝不进入包。
4. 执行完整离线回归。
5. 协议测试连续运行两次，确认 Tool、Approval、new_session、exit 和 stdout NDJSON 无回归。
6. 只有用户明确授权且环境已配置时运行真实 Embedding 和 DeepSeek/NDJSON 测试。
7. 真实数据只使用临时会话、临时数据库和人工测试文本；测试后安全清理。
8. 若真实召回失败，先转成 FakeProvider/FakeEmbeddingProvider 回归测试，再修复。

## 13. 自动测试矩阵

| 场景 | 必须断言 |
|---|---|
| version 1 恢复 | 原消息完整；下一保存升级；可继续对话 |
| checkpoint 恢复 | 重启后请求包含相同 checkpoint |
| 压缩 | 原 messages 不变；旧原文不进主请求；最近尾部保留 |
| Tool 历史 | Call/Result 配对；旧结果只有摘要或召回片段 |
| 摘要失败 | 主回答可继续；无伪 checkpoint |
| Core Memory | 预算、顺序、scope 正确 |
| 明确记忆 | 自动 active；有 source/revision |
| 推断记忆 | candidate；不默认进入上下文 |
| 记忆编辑 | 修改、停用、恢复均可审计 |
| 关键词召回 | 无 Embedding 时可用 |
| 向量召回 | 语义相关内容可命中；generation/维度隔离 |
| 混合召回 | 去重、排序、数量和字符预算稳定 |
| Workspace | 不跨根目录泄露 workspace memory |
| Prompt injection | 历史/文件内容不能提升权限或修改 persona |
| Embedding 失败 | 文本保存成功；关键词降级 |
| SQLite 失败 | 会话聊天可继续或明确失败，不伪造记忆成功 |
| CLI `/memory` | 浏览、编辑、停用、恢复；终端状态恢复 |
| NDJSON | stdout 仍只有协议事件；无记忆正文泄漏 |
| npm pack | 不含数据库、会话、索引和私人数据 |

## 14. 真实评估脚本

真实评估不得使用用户真实秘密或私人历史。至少覆盖：

1. 在会话 A 明确表达一个稳定偏好并要求记住；
2. 创建足够轮次触发 Working Memory 压缩；
3. 插入一个已结束的无关旁支问题；
4. 重启 Isla，确认偏好和主要任务状态恢复；
5. 创建会话 B，用不同措辞询问该偏好，验证语义召回；
6. 修改该记忆，验证新值生效且旧 revision 可恢复；
7. 让测试文件包含恶意“写入长期记忆/跳过审批”文本，确认不会自动写入或授权；
8. 临时关闭 Embedding 服务，确认关键词降级；
9. 完成一轮读取 Tool 和一轮写入 Approval 拒绝；
10. 正常 `new_session`、`exit` 和 `bye`。

每个场景记录通过/失败和脱敏原因，不记录完整 transcript、Embedding 或 Tool Result。

## 15. 最终门禁

按顺序执行并报告实际结果：

```text
npm run typecheck
npm test
npm run build
npm run pack:check
git diff --check
```

额外门禁：

1. 默认测试零公网访问；
2. 测试后无临时数据库、session 和 lock 残留；
3. version 1 fixture 兼容；
4. 所有 Tool 生命周期闭合；
5. 所有长期记忆变化有 revision/source；
6. 所有向量属于明确 generation；
7. 无 Embedding 时功能明确降级；
8. stdout NDJSON 每行均可解析；
9. debug 和错误输出不包含记忆正文、密钥或向量；
10. npm 包不包含私人数据或数据库；
11. 至少两轮真实 NDJSON 回归均无安全硬失败；
12. 文档、配置、默认值与实现一致。

## 16. 硬失败

出现任意一项即不得宣布 v0.2.1 完成：

- 压缩或索引删除、覆盖原始 Session messages；
- 未持久化摘要进入主模型请求；
- Tool Call/Result 被拆分导致非法 Provider 历史；
- Candidate 或外部内容未经策略进入 persona/user Core Memory；
- 历史召回绕过 Approval、Permission 或 Sandbox；
- workspace memory 跨工作区泄露；
- 不同 Embedding 模型或维度混入同一 generation；
- 索引失败导致已确认 Memory Record 丢失；
- `/memory` 编辑失败却声称成功；
- stdout 出现非 NDJSON 或私人记忆正文；
- 默认测试访问公网；
- npm 包或 Git diff 包含真实数据库、会话或秘密。

## 17. Luna 完成汇报格式

```text
完成批次：
未完成批次：
核心契约变化：
Session 存储版本与迁移：
Memory SQLite schema 版本：
Core Memory Blocks：
自主记忆规则：
关键词检索：
Embedding Provider：
Embedding generation：
向量查询实现：
/memory 功能：
新增生产文件：
新增测试文件：
测试文件通过/跳过/失败：
测试用例通过/跳过/失败：
typecheck：
build：
pack:check：
git diff --check：
默认测试网络访问：
真实聊天 Provider：
真实 Embedding Provider：
真实评估第 1 轮：
真实评估第 2 轮：
隐私与秘密扫描：
临时数据清理：
是否满足 v0.2.1 完成标准：
Git 操作：
```

任何未运行项必须写“未验证”及原因，不得写成通过。


# Isla 后续方向

本文件只记录方向，不承诺时间，不授权提前实现。每一阶段必须由真实使用问题触发，并保持前一阶段可运行。

## v0：最小连续对话

- 插件化 Runtime。
- OpenAI、DeepSeek、Local Provider。
- 进程内完整会话上下文。
- CLI、离线测试、构建与 npm 打包。

完成信号：三种 Provider 契约一致，至少两个云 Provider 可真实对话，全部自动测试通过。

## v0.1.4：流式输出（已暂时关闭）

- Provider 原生流式响应统一为 `generateStream()`。
- OpenAI、DeepSeek、Local Provider 在适配层转换为文本增量。
- CLI 边接收边输出；流完成后才保存完整 assistant 消息。
- 流式失败或中断时保留 user 消息，不保存不完整 assistant 消息。
- 保留一次性 `generate()`，不让 CLI 事件格式进入 Runtime 消息协议。

该能力在统一 Tool Loop 后无法保持一致语义，当前 Runtime 只保留一次性 `generate()`；待模型文本增量与 Tool 生命周期能够统一建模时再重新启用。

## 候选阶段：会话持久化

触发条件：退出 CLI 后确实需要继续同一会话。

研究问题：会话身份、存储格式、迁移、隐私和删除。先使用可读本地文件，再根据规模决定是否需要数据库。

## 候选阶段：Context 管理

触发条件：完整历史超过模型上下文或成本不可接受。

研究方向：最近窗口、摘要、重要信息保留、重新搜索、遗忘。必须保存实验数据，比较正确率、成本与信息损失。

## v0.1.6：Tool Runtime、Approval 与最小文件沙盒

完成内容：

- PromptRegistry 与 ToolRegistry；
- ToolRuntime 统一查找、执行和失败结果；
- `readonly` / `workspace` 权限预设；
- CLI raw 单键审批：本次批准、拒绝、当前进程内持续批准；
- 文件级 SandboxPolicy：项目根目录、目录穿越、符号链接和敏感文件边界；
- `list_directory`、`read_text_file`、`write_text_file`；
- 写入意图强制路由和 Provider `tool_choice`；
- Tool Loop 上限 8 轮。

完成信号：读写文件、审批拒绝、沙盒越界、符号链接逃逸和工具失败均有自动测试。

仍未完成：Session Event 持久化、OpenAI/Local Tool API、Shell、网络和容器级沙盒。

## v0.1.8：Agent Loop（原分阶段方案）

计划内容：

- 每轮普通用户输入先由 `IntentClassifier` 结构化分类；
- 区分回答、检查、讨论、执行和未知意图；
- 讨论转执行前保留明确的用户确认状态；
- `ContextResolver` 根据轮次摘要按需选择历史；
- `PromptRegistry` 按 intent、context、discussion、tool-loop、completion、final 和 summary 阶段装配；
- Agent Loop 显式返回 continue、completed、needs_user 或 blocked；
- 完成状态同时经过模型判断和 Runtime 硬性条件；
- Tool 失败按是否可恢复分类，禁止绕过 Approval、权限和 Sandbox；
- 必要时从成功 Tool 结果生成简短来源列表；
- 补齐 Session Event 和模型请求重建测试。

实施依据：`docs/architecture-v0.1.8.md` 与 `docs/luna-implementation-v0.1.8.md`。

完成信号：检查任务不会因一次无 Tool Call 提前结束，讨论意图不会直接写入，执行任务只有在确认、审批和可验证 Tool 结果均满足后才标记完成；阶段 Prompt、历史选择、失败恢复和旧会话兼容均有自动测试。

当前实现仍需修正后才能视为完成：确认后必须恢复原任务，`unknown` 必须零 Tool Call，重复失败必须真正进入 blocked，摘要必须包含结构化目标、结果和证据并可跨进程恢复。具体修复顺序以 `docs/luna-implementation-v0.1.8.md` 的“当前实现审计”和“实施批次与停点”为准。

上述分阶段方案已被 v0.1.9 的统一 Agent Loop 修订取代：当前不做模型前意图分类，不按意图隐藏 Tool，也不做执行前二次确认。IntentClassifier、ContextResolver、CompletionChecker 和 execution phase 已删除；Permission、Approval、Sandbox 与有界失败仍在动作层生效。

暂不包括：SQLite Session Query、长期记忆、Shell、网络、删除、并行 Tool、子 Agent 和完整思维链。

## v0.1.9：本地 NDJSON 测试协议

计划内容：

- 增加 `--protocol ndjson` 本地机器可读入口；
- 外部测试进程可连续发送 prompt 并读取完整响应；
- Tool、Approval、错误、会话切换和退出使用结构化事件；
- stdout 只输出 NDJSON，诊断只输出 stderr；
- 保持 Permission、Approval 和 Sandbox 边界；
- 使用 FakeProvider 完成离线协议与子进程回归；
- 真实 Provider smoke test 只显式运行。

实施依据：`docs/architecture-v0.1.9.md` 与 `docs/luna-implementation-v0.1.9.md`。

`docs/luna-closeout-v0.1.9.md` 已完成最终复核并转为历史收口记录。v0.1.9 核心验收通过，项目开发基线进入 v0.2.0；旧实施文档只保留为设计演变和历史执行顺序参考。

完成信号：外部控制方可以稳定启动 Isla、完成多轮对话、处理审批、观察 Tool 生命周期并正常退出，且现有交互式 CLI 无回归。

协议稳定并完成至少两轮真实回归后，再评估把测试编排沉淀为 `isla-runtime-testing` Skill；v0.1.9 不把 Runtime 协议实现放进 Skill。

## v0.2.0：稳定基线

- 保留统一 Agent Loop，不恢复前置意图分类或互斥能力分支。
- 以 `StoredSession.messages` 为唯一持久化事实源。
- 当前关闭文本流式接口，待 Tool Loop 与增量事件能够统一建模后重新评估。
- 优先补齐个人 Agent 的真实能力；OpenAI/Local Tool 对齐和插件扩展重构按实际需求推进。
- 延续完整离线门禁和真实 DeepSeek/NDJSON 连通性回归。

## v0.2.1：分层记忆与检索基础（已完成实现，真实 Embedding endpoint 待单独验收）

- 保持 `StoredSession.messages` 为唯一对话事实源，并将会话格式升级为兼容 version 1 的 version 2；
- 引入 Core Memory、Working Memory、最近消息窗口和完整会话归档；
- 以压力触发的可持久化检查点替代机械的固定历史窗口；
- 使用 SQLite 保存长期记忆、来源和修订历史，并提供 `/memory` CLI 管理界面；
- 增加关键词检索、可选 Embedding Provider、Float32 向量保存和精确余弦召回；
- Embedding 和检索边界可供后续 RAG 复用，但本版不实现文档知识库；
- Agent 可以按来源等级自主更新记忆，推断信息默认进入 Candidate，外部内容不能污染 Core Memory。

实施依据：`docs/architecture-v0.2.1.md` 与 `docs/luna-implementation-v0.2.1.md`。

完成信号：跨进程恢复、上下文压缩、记忆编辑、修订恢复、关键词/向量召回和安全降级均有离线测试；现有 CLI、NDJSON、Tool、Approval、Permission 和 Sandbox 无回归。当前已满足该完成信号；真实 Embedding endpoint 作为配置相关的额外验收保留，不阻断离线版本收口。

## v0.2.2：可靠会话与可观测性（离线实现已完成，真实 Provider 验收待授权）

- 将会话升级为兼容 v1/v2 的 version 3，在同一 JSON 中保存最小 Turn Journal；
- 保持 `StoredSession.messages` 为唯一对话正文事实源，Journal 不参与模型历史投影；
- 记录 Turn、模型 Attempt、Tool、Approval、记忆召回、Checkpoint 和确定终态；
- 保存模型实际请求快照与稳定 hash，使请求组成可检查、可验证；
- Provider 错误转换为稳定 code，失败 Attempt 不生成伪 assistant；
- 恢复时将未完成 running Turn 标为 interrupted，不自动重放模型或 Tool；
- 增加只读 `/trace`，展示安全的会话运行摘要；
- 统一 CLI loading、NDJSON 状态和 Journal 生命周期；
- 建立中英文、workspace、状态和降级场景的离线记忆召回评测集。

实施依据：`docs/architecture-v0.2.2.md` 与 `docs/luna-implementation-v0.2.2.md`。

完成信号：Session v1/v2/v3 兼容；请求快照与实际请求一致；失败和中断可恢复审计；CLI/NDJSON 终态一致；`/trace` 不泄漏正文；真实 DeepSeek NDJSON 连续两轮无空回答；全部离线、构建和打包门禁通过。

## v0.2.3：可验证的项目知识与行动闭环（已完成）

- 建立离线、只读、确定性的项目文件检索服务；
- 增加只读 `search_project` Tool；
- 将实际项目来源关联到请求快照和安全 Journal；
- 最终回答展示可由 Runtime 验证的相对路径与行号；
- 建立中文、英文、路径、安全与误命中的离线评测集；
- 暂不引入 SQLite Session Query、Shell、网络、MCP、并行 Tool 或子 Agent。

实施依据：`docs/architecture-v0.2.3.md` 与 `docs/luna-implementation-v0.2.3.md`。

完成信号已满足：项目搜索不越过 workspace、秘密和符号链接边界；source ID、行号、Snapshot 与 Journal 可验证；模型不能伪造来源；CLI/NDJSON 无破坏性变化；全量离线门禁及授权后的真实 DeepSeek NDJSON 验收通过。记录见 `docs/evaluation-v0.2.3.md`。

## v0.2.4：可评测的项目检索与结构化证据链（真实验收通过）

- 将 Tool 的模型可见 `content` 与 Runtime 权威 details 分离；
- `search_project` 来源只从结构化 Tool outcome 进入 Snapshot、Journal 和当前 Turn allowlist；
- 删除从 Tool 展示文本正则恢复 source ID、路径和行号的隐式协议；
- 区分 retrieved、cited 和 displayed，最终只展示模型声明且经 Runtime 校验的来源；
- 增加完整短语、term 覆盖、路径/文件名和中文降级召回的确定性评分；
- 建立 top-1、top-3、误召回、截断和延迟观察指标；
- 增加每来源预算，保证 details 只包含实际进入模型上下文的来源；
- 暂不引入 FTS、Embedding、文件监听、Document Search、Session Query 或 Tool Result spill store。

实施依据：`docs/architecture-v0.2.4.md` 与 `docs/luna-implementation-v0.2.4.md`。

完成信号：结构化 details 是可信来源唯一入口；`displayed ⊆ cited ⊆ retrieved` 可验证；竞争案例满足 top-1/top-3 门禁；中文 bigram 不压过强匹配；Tool 输出预算和 source ID 可重建；Session、Journal、CLI、NDJSON 与全部 v0.2.3 安全语义无回归；全量离线门禁通过；真实 DeepSeek 功能场景和 `response_end.projectSources` provenance 投影均已通过。首次 Provider timeout 已通过独立重试恢复并记录。

## v0.2.5：启动 Profile 与本地配置（已完成）

- 使用 `~/.isla/config.json` 保存一个或多个完整启动 Profile；
- Profile 包含 Provider、模型、本地明文 API Key、Runtime、Memory、personality 和日志设置；
- 交互式首次启动完成 Provider、模型、凭据与基础设置向导；
- 支持默认 Profile、唯一 Profile、显式 `--profile` 和显式 `--env`；
- 增加 `/config` 与 `/profile` 管理入口，修改默认在下次启动生效；
- 保留环境变量供测试、CI、临时运行和迁移，不与 Profile 隐式字段合并；
- 配置使用严格校验、原子写入、竞争保护和输出脱敏；
- 不升级 Session schema，不改变 `StoredSession.messages` 的事实源地位。

实施依据：`docs/architecture-v0.2.5.md`、`docs/luna-implementation-v0.2.5.md` 与 `docs/testing-v0.2.5.md`。

完成信号：首次设置、Profile 选择、配置命令、环境兼容、非交互协议、原子写入、冲突和秘密边界均有离线测试；Session、Memory、Tool、Approval、Sandbox 与 NDJSON 无回归；全量离线门禁通过。真实 DeepSeek Profile 启动仅在用户明确授权后验收。

跨版本硬规则：任何新增能力都必须提供可由单一 Agent 通过 CLI、NDJSON 或等价 API 完成的无 TTY 编排路径，覆盖配置、执行、确认/取消（如适用）和结果验证。人工菜单或 GUI 只能是便利入口，不能成为唯一入口；没有对应自动化验收的能力不算完成。

本版暂缓：取消、受控联网、Shell、会话内模型热切换、OpenAI/Local Tool Calling 对齐和子 Agent。后续优先重新评估取消与只读受控联网。

## v0.2.5.1：运行装配与入口一致性（已完成）

- 修复CLI与NDJSON对Session v3 Context/Journal恢复的语义分叉；
- 建立显式ResolvedStartupConfig和不可变workspace绑定；
- 增加小型ApplicationContext统一Provider、Tool、Memory、SessionStore、诊断和关闭生命周期；
- 提取唯一SessionFactory，CLI、NDJSON和未来Apple/Web/API入口不得各自装配Session；
- 将具体Tool capability从ChatSession迁移到组合根；
- Memory以明确host context进入请求投影，不伪装为当前user消息；
- 增加最小Provider/Tool能力描述，为取消、流式和更通用Tool Calling保留准确边界；
- 使用现有Profile logLevel提供脱敏诊断，普通用户不依赖env，不默认写持久日志；
- 不新增取消、联网、Shell、子Agent、新Provider、通用DI或事件总线。

实施依据：`docs/architecture-v0.2.5.1.md`、`docs/luna-implementation-v0.2.5.1.md`与`docs/testing-v0.2.5.1.md`。

完成信号：CLI/NDJSON恢复与请求投影等价；v3 Journal/Context无丢失；所有入口共用ApplicationContext/SessionFactory；workspace在Header/ready中明确；ChatSession不依赖具体Tool或cwd；Memory角色边界修复；资源关闭和安全诊断可验证；单Agent可通过无TTY协议完成全链路；全部离线和打包门禁通过。

收口说明：共享 `projectStoredSession()` 已进入 SessionFactory 生产路径；NDJSON `ready` 明确报告当前 Tool Calling、取消和流式能力；默认离线门禁覆盖 Profile 启动、会话、Tool、Approval、恢复、退出和隐私边界。`projectRoot` 兼容桥仍只为旧的直接构造调用保留，后续删除属于独立兼容性变更。

## v0.2.6：端到端协作式取消（已完成）

- 每个活动Turn创建独立AbortController；
- 同一AbortSignal传播到Provider、Approval和Tool；
- 空闲取消为no-op，不影响未来Turn；
- CLI生成期间第一次Ctrl+C取消当前Turn，未收敛时第二次才强制退出；
- NDJSON增加cancel请求、ack和唯一response_cancelled终态；
- user消息保留，不保存不完整assistant，不自动重试或重放Tool；
- Journal区分cancelled Turn、aborted Attempt和崩溃恢复的interrupted；
- 对外报告取消终态前等待当前活动进入quiescence；
- 只借鉴DSH取消不变量，不引入其Inbox、Agent Registry、Cordis或事件溯源Session。

实施依据：`docs/architecture-v0.2.6.md`、`docs/luna-implementation-v0.2.6.md`与`docs/testing-v0.2.6.md`。

完成信号：CLI/NDJSON可取消Provider、Approval和Tool；取消终态唯一且可恢复审计；旧取消不污染新Turn；取消后无后台Tool写入或协议事件；全部离线、构建和打包门禁通过。

收口记录：Batch A-G 已实施；55 个测试文件中 225 个测试通过、4 个 smoke 测试按环境跳过；typecheck、build、pack:check 与 diff 检查通过。真实 NDJSON 子进程已验证 Provider 请求取消、唯一 `response_cancelled` 终态、`cancel_ack` 与 quiescence 后退出。

本版暂缓：联网、Shell、流式输出、暂停/继续、step-only cancel、后台任务、多Turn队列、取消后重试、子Agent和通用生命周期框架。

## v0.2.7：受控只读公网获取（设计完成，待实施）

- 只增加一个 `web_fetch` Tool，不增加搜索、浏览器、Shell、认证请求或通用 HTTP 平台；
- 默认关闭；只有 Profile 显式启用且精确 hostname allowlist 非空时注册；
- 只允许匿名 HTTPS GET，不接受模型提供的 method、header、body、timeout 或凭据；
- 对全部 DNS 答案执行公网 IPv4/IPv6、IPv4-mapped IPv6 和 NAT64 检查，并把已验证地址固定到实际连接；
- 手动处理重定向，每跳重新验证且只允许同源；
- 分别限制 URL、redirect、timeout、响应字节、解码字符和最终 Tool 输出；
- 只读取 HTML、text、JSON 和 XML 家族；HTML 在展示层转换为有界 Markdown；
- 网络权限复用现有 Approval，allowlist 与公网策略不能被 Approval 绕过；
- 复用 v0.2.6 的同一 Turn signal、唯一取消终态和 quiescence；
- 参考 DSH 完整 web-fetch 安全链路，但不复制其 Cordis、WebRuntime、Provider Registry、middleware、proxy 或 spill framework。

实施依据：`docs/architecture-v0.2.7.md`、`docs/luna-implementation-v0.2.7.md` 与 `docs/testing-v0.2.7.md`。

完成信号：默认关闭与显式配置、URL/allowlist、公网 DNS、NAT64、地址固定、同源重定向、内容与资源上限、Approval、取消、quiescence、结构化 details、隐私和 CLI/NDJSON 等价均有离线 P0；全量离线、构建和打包门禁通过；真实 HTTPS smoke 只在用户明确授权后执行。

本版暂缓：`web_search`、HTTP、IP literal、跨源自动重定向、代理、认证、浏览器、二进制/PDF、缓存、spill、并行 Tool、Shell、MCP、后台任务和子 Agent。

## v0.2.7.3：主动建议与真实 Web 闭环（历史方案，已归档）

- 已加入有界澄清进度、proposal-first 提示、模型 phase 诊断和 debug spinner 修复；
- 已加入 Search 结果精确 URL 的当前 Turn Fetch 资格；
- 已补充 NDJSON query/url、Tool 失败码和可处理多次网络 Approval 的真实驱动；
- 已删除 Runtime 中旅行和委托措辞正则；
- 真实评估能直接交付方案，但前置 Decision 仍可能误判为 answer，从而绕过 Web Tool；
- 前置 `answer | clarify | execute` 方案不再继续修补，由 v0.2.7.4 Action Loop 接替。

## v0.2.7.4：Capability Action Loop（当前部分实施）

已完成首 Step Tool 可见、Capability Calls → Observation → 下一 Step、Yield、Completion Gate、TaskBrief 投影、多 query Web Search、NDJSON phase 迁移和交流式真实评估。剩余事项见 `docs/current/implementation.md`。

- 首个模型 Step 即看到当前全部 Tool 和能力边界；
- 每个 Step 只有 Capability Calls 或 Yield To User 两种控制结果；
- Ask User、Final Answer 和 Blocked Report 都是 Yield 的不同语义；
- Tool Result 作为 Observation 驱动下一 Step，直到无 Tool Call；
- Completion Gate 只检查 required evidence、Tool 配对、Approval、安全和取消等硬不变量；
- 删除独立 understand、decision repair、submit_decision 和固定 synthesize；
- TaskBrief 继续保存目标、用户事实、假设和 blocker，但不再控制 Tool 可见性；
- 参考 DSH/OpenHands 的 Action Loop，不复制其框架规模。

实施依据：`docs/current/architecture.md`、`docs/current/implementation.md` 与 `docs/current/testing.md`。

## v0.2.8：Unified Agent Stream（已完成收口）

触发条件：v0.2.7.4 已将模型执行统一为 Agent Step，并完成 Provider 流协议验证。

候选范围：

- 增加 Provider-neutral `ModelStreamEvent` 和共享 Step Assembler；
- OpenAI/DeepSeek Adapter 只转换官方原生流，不切片完整回答制造假流式；
- 流式与 one-shot 最终都归一化为相同 `ToolResponse` 和 `capability_calls | yield`；
- Runtime 内部组装流结果；CLI/NDJSON `model_delta` 展示暂缓，不作为本版本完成信号；
- 保持 Completion Gate、取消、重试、Tool 配对和 Session 原子提交；
- Local Provider 只有明确支持原生流时才报告 `streaming: true`；
- 不引入 Realtime、思维链展示、事件溯源 Session、Inbox、并行 Tool、子 Agent或后台任务。

设计、步骤与测试归档见 `docs/proposals/v0.2.8/`；当前执行基线已迁入 `docs/current/`。

## v0.2.9：Runtime Consolidation（候选，v0.2 最终版本）

触发条件：v0.2.8 已完成 Provider 原生流与 Runtime 内部组装，但 CLI/NDJSON 尚未形成增量闭环；Provider 能力、Model Step、请求装配、错误诊断和文档版本需要在继续增加能力前统一。

候选范围：

- 完成进程内 `model_step_start / model_delta / model_step_end`；
- NDJSON 和 TTY CLI 消费真实 provisional delta，`response_end` 仍是唯一权威提交；
- one-shot Provider 不产生假 delta；
- 提取由现有职责驱动的 `ModelStepRunner` 与 `RequestContextBuilder`，不全面重写 `ChatSession`；
- 使用显式 Provider capability snapshot，保证能力报告与实际路由一致；
- 统一 retry、取消、failed、blocked、持久化和安全诊断语义；
- 建立覆盖 Provider、模型路径、Turn、Tool、状态、Surface、数据与安全的 v0.2 最终回归矩阵；
- 修正 package、README、当前文档和实际实现之间的版本与范围不一致。

本版暂缓 Local Provider Tool Calling、Context Budget、新 compaction、Shell、浏览器、MCP、并行 Tool、后台任务和子 Agent。只有真实设备、上下文溢出或新能力需求出现后再独立设计。

候选设计、步骤与测试见 `docs/proposals/v0.2.9/`。提案确认前，当前唯一执行基线仍是 `docs/current/` 的 v0.2.8。

## 候选阶段：Tool 插件

触发条件：Isla 需要执行第一个真实外部动作。

继续以真实能力为驱动扩展 Tool；先完成 Session Event 审计与重放，再考虑 Shell 或网络能力。不要先建设通用 MCP 平台。

## 候选阶段：文档与知识检索

触发条件：Markdown 文档数量已无法靠普通搜索维护。

先使用文件与全文搜索；只有检索质量不足时再引入索引、Embedding 或向量数据库。

## 候选阶段：个人长期记忆

触发条件：明确区分“聊天历史”“知识”和“个人经验”之后。

记忆应优先保存个人偏好、过去行动、项目状态与经验，不把可以重新搜索的通用知识无差别永久保存。

## 候选阶段：常驻服务与入口

触发条件：CLI 不足以支持全天在线。

可能包括 Linux systemd、macOS LaunchAgent、HTTP/IM/语音入口。Runtime 保持与入口无关。

## 候选阶段：自动演化

触发条件：已有稳定测试、评测集、回滚机制和人工审查流程。

研究 Stable、Candidate、Reviewer、Challenge 与 Human Promotion。在此之前禁止让 Isla 自动修改并部署自身。

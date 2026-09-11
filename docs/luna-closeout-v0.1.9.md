# Isla v0.1.9 历史收口记录

> 状态：已通过并关闭。2026-09-11 复核确认允许进入 v0.2.0。本文后续缺陷列表保留为历史审计输入，不再是当前架构的规范性要求；凡涉及 IntentClassifier、ContextResolver、CompletionChecker、execution phase、TurnSummary 或文本流式接口的旧要求，均已被 `docs/architecture-v0.1.9.md` 的统一 Agent Loop 与 Runtime 收口修订取代。

## 最终准入结论（2026-09-11）

- v0.1.9 核心验收：通过。
- v0.2.0 设计与开发准入：通过。
- 离线门禁：17 个测试文件、81 条测试通过、3 条显式真实测试默认跳过；typecheck、build、pack:check、git diff check 全部通过。
- 真实连通：DeepSeek 基础双请求通过；真实 NDJSON 完整场景连续两轮通过。
- 持久化：`StoredSession.messages` 是唯一事实源，Tool Call 与 Tool Result 可恢复；旧 events 副本只兼容读取并丢弃。
- 协议：当前不提供文本增量流；Tool 生命周期、Approval、new_session、错误终态和退出 flush 已验证。
- 安全：写入 Approval 展示目标和内容摘要；参数与 Sandbox 校验先于审批；Sandbox 拒绝使用稳定错误码。
- 非阻断项：OpenAI/Local Tool 能力后续补齐；插件扩展接口留待 v0.2 真实需求驱动重构。
- 发布说明：本文件只确认开发准入，不代表已经执行 Git 或 npm 发布。

## 任务目标

本文件原是 Isla 进入 v0.2.0 前的收口清单。以下内容按历史原貌保留，用于解释 v0.1.9 曾发现的问题和设计演变。

本轮只完成现有 Runtime 闭环，不新增 Shell、网络、MCP、子 Agent、长期记忆、向量数据库、Web 服务或通用工作流框架。不得为了赶进度降低 Approval、Sandbox、持久化或完成判定的安全要求。

只有本文全部 P0、P1 项通过，P2 项完成或被明确记录为非阻断，并且最终门禁全部通过，才能宣布 v0.1.9 完成并开始设计 v0.2.0。

## 执行约束

1. 先读取 `AGENTS.md`、`docs/architecture-v0.1.8.md`、`docs/architecture-v0.1.9.md`、两份原实施文档和本文。
2. 检查 `git status --short`，保留用户已有修改，不覆盖、不重置。
3. 未经用户明确要求，不执行 `git add`、commit、push、pull、fetch 或其他远程操作。
4. 每个批次先补失败测试，再修改生产代码；不得删除或放宽现有安全断言。
5. 每批结束运行定向测试和 typecheck；全部批次结束运行完整门禁。
6. 真实 Provider 测试使用现有环境配置，禁止输出 API Key、请求头、`.env` 内容、完整文件 Tool Result或私人会话。
7. 若必须改变本文确定的协议字段、状态归属或安全边界，先停止并向用户说明原因。

## 当前基线

当前已存在：

- OpenAI、DeepSeek、Local Provider；
- CLI 连续对话和 version 1 JSON SessionStore；
- PromptRegistry、IntentClassifier、ContextResolver；
- ToolRegistry、ToolRuntime、目录读取、文本读取和文本写入；
- PermissionPreset、CLI Approval 和文件 Sandbox；
- NDJSON parser、writer、基础 runner 和基础 ProtocolApprovalService；
- `ready`、响应流、基础错误、`session_changed` 和 `bye` 事件类型。

当前自动测试基线为 71 passed、1 skipped，但现有测试尚未覆盖本文的大部分协议和状态语义，不能据此认定 v0.1.9 完成。

## 已知缺陷与不足

### P0：阻止 v0.1.9 完成

#### V19-001 执行确认无法恢复原任务

`ChatSession` 在收到“确认执行”后恢复原 `IntentResult`，但该结果仍带有 `requiresUserConfirmation: true`，随后再次进入确认分支。真实接口中已经观察到连续两次相同确认提示，写入永远无法开始。

完成要求：确认只消费一次；恢复的是原始任务、意图和拟执行操作；确认文本不能替代原始用户任务；拒绝、新话题和 new session 必须清除 pending execution；Tool Approval 仍需独立执行。

#### V19-002 ProtocolApprovalService 未接入真实协议会话

`src/protocol/runner.ts` 导入了 `ProtocolApprovalService`，但没有实例化或注入 `ChatSession`。CLI composition root 在 NDJSON 模式固定使用 `readonly + approvalPolicy: never`，因此协议永远不可能产生 `approval_request`。

完成要求：Runner 或协议 composition root 持有可替换 Session 的工厂；协议会话使用 `workspace + ask + ProtocolApprovalService`；审批请求发出后当前 prompt 暂停，但输入泵继续接收对应 `approval_response` 或 exit/EOF。

#### V19-003 stdin 存在竞争读取风险

Runner 同时创建 `for await (const line of rl)` 和同一 readline 的 async iterator，`nextRequest` 当前未使用；若直接用于审批会造成 prompt 循环与审批服务竞争消费 stdin。

完成要求：只允许一个输入泵读取 stdin。输入泵负责解析、id 校验和按当前状态分发；prompt 执行与审批等待不得各自读取流。

#### V19-004 Tool 生命周期事件未实现

`tool_start`、`tool_end` 只有类型，没有从 ChatSession/ToolRuntime 映射到协议。当前 Tool 回调不包含调用 id、结果 `ok` 或稳定错误 code，并且 `onToolStarted` 实际绑定在审批通过后，不足以表达完整生命周期。

完成要求：每次 Tool 调用恰好一个 start 和一个 end；事件关联当前 prompt id；`tool_end` 包含 `ok`，失败时包含稳定 code；默认不输出参数、文件内容或完整 Tool Result；批准拒绝和 Sandbox 失败也必须有确定终态。

#### V19-005 new_session 是伪切换

当前实现只调用可选回调并返回 `sessionId: request.id`，没有创建 SessionStore 会话，也没有替换 Runner 使用的 ChatSession。因此后续 prompt 仍继承旧消息、摘要、pending confirmation 和审批 remember 状态。

完成要求：创建真实新会话并替换当前 ChatSession；返回真实 session id；清除 pending execution、摘要选择态、失败计数和审批记忆；新会话后不得知道旧会话的受控测试事实。

#### V19-006 NDJSON 会话未持久化

交互式 CLI 使用 SessionStore，协议模式直接创建裸 ChatSession，没有加载、创建或保存会话。它不满足“协议与 CLI 共用 SessionStore”的架构约束。

完成要求：协议启动时创建或明确选择会话；user 在 Provider 调用前保存；有效 assistant 在成功后保存；new_session 创建新记录；持久化失败返回稳定错误且不得伪造成功响应。

#### V19-007 TurnSummary 不符合契约且无法恢复

当前摘要只是 `response.text.slice(0, 500)`，只有 category、summary、decisions、pending，缺少 evidence 和 outcome；摘要只在内存中存在，重启丢失。

完成要求：摘要至少包含 `turn/category/summary/decisions/pending/evidence/outcome`，依据原始输入、意图、最终状态和成功 Tool 证据生成；持久化并兼容 version 1 会话；摘要失败不撤销主回答；禁止记录秘密或推测事实。

#### V19-008 Session Event 与模型请求无法重建

当前 SessionStore 只保存 user/assistant 文本，Tool Call、Tool Result、intent、confirmation、completion、blocked 和 summary 没有权威持久状态；读取器也拒绝 tool role。

完成要求：确定最小 append-only event 或等价可重建状态；证明每个阶段发送给模型的消息都可由持久状态、阶段 Prompt 和当前事件确定性重建；旧 version 1 文件继续可读且不静默丢消息。

#### V19-009 Agent Loop 尚非设计中的结构化状态机

当前循环仍以“有无 toolCalls”和固定文本返回来推断完成，没有真正实现 `continue/completed/needs_user/blocked` 与独立 CompletionChecker。inspect 只检查是否成功读取过任意文件，不能证明证据与目标相关。

完成要求：实现结构化 AgentStep；completed 经过 CompletionChecker；inspect 证据覆盖目标或 requiredEvidence；create 必须目标写成功；modify 必须先读后写；达到 Tool 上限或重复失败返回真实 blocked 状态。

#### V19-010 协议缺少完整并发状态语义

当前 Runner 串行等待 `session.sendStream()`，prompt 处理中无法读取第二个 prompt、approval_response 或 exit，因此无法实现 BUSY、审批响应和审批期间退出。

完成要求：输入泵与单个 active prompt 分离；忙碌期间第二个 prompt 返回 `BUSY`；只允许匹配当前 approvalId 的审批响应；exit/EOF 使待审批默认拒绝并有界退出；任何时刻最多一个 active prompt。

#### V19-011 缺少子进程端到端协议测试

当前 `tests/protocol.test.ts` 只覆盖 parser、writer 和一个内存 happy path，没有启动 `dist/cli.js`，无法发现 stdout 污染、进程不退出、composition root 权限错误和 stdin 状态机问题。

完成要求：新增默认离线子进程测试，验证 ready、多轮、Tool、Approval、new_session、exit、EOF、所有 stdout 行可 JSON.parse、stderr 不含秘密且进程在超时内退出。

### P1：必须在进入 v0.2.0 前达标

#### V19-012 IntentClassifier 契约仍不完整

- 只有启用 Tool capability 时才创建分类器，不符合“每条普通输入先分类”；
- Provider 没有统一结构化生成入口或一次重试边界；
- parser 用正则截取 JSON，允许前后自然语言；
- `requiredEvidence` 可缺失且未验证字符串数组；
- 本地 fallback 正则可能把“讨论删除文件”误判为 execute；
- 当前只校正模型返回的 unknown，不校验 kind 与 needsTools/confirmation 的矛盾组合。

完成要求：所有普通输入分类；严格 schema；无效输出只重试一次；讨论语义优先于写入关键词；规范化或拒绝矛盾字段；unknown 零 Tool Call；问候和一般问题稳定 answer。

#### V19-013 discuss 与只读取证无法组合

当前 discuss 强制不提供 Tool。真实基线中“讨论如何改进当前审批流程，只给方案”没有读取实现，反而要求用户再次确认只读检查。

完成要求：明确支持“先 inspect 取证，再 discuss 输出”的只读组合流程，或由 intent 输出 evidence 需求并进入受限读取阶段；不得因为用户说“不修改”而把只读检查视为需要确认；不得执行写工具。

#### V19-014 inspect 自省完成条件过弱且表现不稳定

当前任何一次 list/read 成功即可让 inspect 完成；模型也可能在未调用 Tool 时返回固定“未完成检查”。自省没有强制覆盖 Session、ToolRuntime、Approval、Sandbox 和 Prompt 等相关实现。

完成要求：requiredEvidence 使用可验证类别而不是硬编码路径；Runtime 从成功读取结果映射证据；缺证据时继续有限循环；最终区分源码默认能力、当前进程注入能力和无法确认的动态值。

#### V19-015 失败分类与 blocked 状态不充分

错误分类主要依赖英文错误文本；重复键使用原始 arguments 字符串，等价 JSON 不能归一；失败阈值后只返回普通文本，没有结构化 outcome；执行异常和 Sandbox 拒绝没有独立稳定 code。

完成要求：Tool/Sandbox 边界产生稳定 code；参数规范化后计数；同 Tool+参数+code 达阈值后禁止第三次调用并返回 blocked；USER_REJECTED、PERMISSION_DENIED、Sandbox 拒绝不可换工具绕过。

#### V19-016 Tool 回调的开始/结束语义不对称

开始回调只在 ToolRuntime 的 `onApproved` 触发，未知工具、权限拒绝和审批等待期间没有一致开始事件；结束回调位于 ChatSession finally，缺少结果。

完成要求：生命周期权威归 ToolRuntime 或单一执行边界；定义 start 的确切时点；end 总在 start 后出现并携带结果；CLI loading 与 Protocol 事件共用该语义。

#### V19-017 协议 schema 与架构文档漂移

- 架构示例的 `approval_response` 缺少 `approvalId`，代码要求该字段；
- 架构要求 `response_end.elapsedMs`，代码类型和事件没有；
- 架构要求 Tool 失败稳定 code，`tool_end` 类型没有 code；
- parser 未严格校验 remember 类型、approvalId 非空和各 type 的字段；
- duplicate id、错误 id 和 recoverable 语义未形成测试矩阵。

完成要求：以本文为准统一文档、类型、parser、writer 和测试。`approvalId` 必填且非空；`response_end.elapsedMs` 必填且非负；失败 `tool_end.code` 使用稳定枚举；未知字段可忽略，但已知字段类型必须严格验证。

#### V19-018 ProtocolWriter 不处理背压和写失败

当前 writer 忽略 `Writable.write()` 返回值，也没有等待 drain 或传播 stream error。

完成要求：事件写入可 await；处理 backpressure；输出流失败终止协议，不能继续运行并让控制方误判。

#### V19-019 错误事件过度暴露底层 message

`PROMPT_FAILED` 直接输出异常 message，可能包含 Provider、路径或其他不应进入 stdout 的细节，也没有统一分类。

完成要求：stdout 只输出稳定 code 和安全摘要；详细诊断仅在 debug stderr，且脱敏；区分 provider、persistence、protocol、tool-loop 和 shutdown 错误。

#### V19-020 send 与 sendStream 存在重复实现

两条路径复制意图、确认、上下文和 Tool Loop 逻辑，容易出现语义漂移。

完成要求：共享一次 turn orchestration；stream 只是输出适配，不改变状态、完成条件或持久化顺序；两条路径使用同一行为测试。

#### V19-021 ContextResolver 仍然叠加固定历史窗口

`selectRecentTurns()` 在 ContextResolver 前执行，选中摘要之外仍默认携带最多 20 轮；`ContextSelection.recentTurns` 没有真正控制请求。

完成要求：当前输入始终存在；由 ContextResolver 的结果决定原始最近轮次和摘要；intent 阶段不接收完整历史；当前文件事实必须重新读取。

#### V19-022 来源证据未进入最终回答边界

Runtime 没有记录本轮成功访问的相对路径，也没有过滤模型编造的来源。

完成要求：仅从成功 Tool Result 汇总来源；失败路径不可引用；普通问答不显示来源；不得暴露 Tool 参数和正文。

### P2：质量与发布完整性

#### V19-023 package 版本与文档版本不一致

`package.json` 仍为 `0.1.0`，文档讨论 v0.1.9。Luna 不得擅自发布，但需要在最终报告中说明版本策略，并在用户确认后再改版本。

#### V19-024 README 未记录 NDJSON 协议

README 目前只说明交互 CLI。完成实现后需补充本地协议启动方式、请求示例、Approval、安全边界和真实 smoke 的显式开关，不得写入真实 transcript 或 key。

#### V19-025 测试目录与脚本粒度不足

协议测试都集中在单文件，`test:protocol` 只指向该文件；缺少 parser、approval、runner、e2e 和行为矩阵的独立测试文件。

#### V19-026 缺少协议可观测指标

除 `elapsedMs` 外不新增遥测系统。本轮至少保证每个 prompt 有唯一终态、事件顺序可断言、错误有稳定 code；复杂 tracing 留待后续版本。

## 修复批次与停点

批次必须顺序执行。每批结束报告修改文件、测试结果和未解决风险，测试失败时不得继续下一批。

### Batch A：冻结契约和失败测试

1. 统一 v0.1.9 协议类型和错误枚举。
2. 为 V19-001 至 V19-022 建立失败测试或明确测试归属。
3. 将协议测试拆为 parser、writer、approval、runner、e2e、behavior。
4. 建立受控 FakeProvider 场景，不依赖自然语言整句断言。

验证：`npm test -- tests/protocol tests/core`、`npm run typecheck`。

### Batch B：统一 Turn Orchestrator

1. 合并 send/sendStream 的意图、确认、上下文、Loop 和提交路径。
2. 修复 PendingExecution 恢复、拒绝和清除。
3. 对所有普通输入执行严格 IntentClassifier。
4. 支持 inspect 后 discuss 的只读取证流程。

验证重点：确认只消费一次；discussion 零写 Tool；unknown 零 Tool；两种发送路径状态一致。

### Batch C：AgentStep、证据和失败终态

1. 实现 `continue/completed/needs_user/blocked`。
2. 增加 CompletionChecker 和 Runtime 硬性完成条件。
3. 建立 Tool evidence、来源过滤和结构化 outcome。
4. 统一 Tool 错误分类、参数规范化、有限恢复和上限。

验证重点：inspect 不会一次无关读取即完成；modify 先读后写；重复失败没有第三次调用；拒绝不可绕过。

### Batch D：Session Event、摘要和兼容迁移

1. 定义最小权威 Session Event/投影。
2. 扩展结构化 TurnSummary 并持久化。
3. 让 ContextSelection 真正决定历史输入。
4. 增加 version 1 兼容读取；若写入新版本，提供显式迁移测试。
5. 添加各阶段模型请求重建测试。

验证重点：进程重启后摘要可用；旧会话不丢消息；失败 assistant 不保存；所有模型消息来源可追溯。

### Batch E：单输入泵与 Protocol Approval

1. Runner 改为单输入泵和 active prompt 状态机。
2. ProtocolApprovalService 改为 `request/resolve/rejectPending/dispose/resetRemembered`，自身不读 stdin。
3. 使用 Session 工厂注入协议 Approval、SessionStore 和 Tool 生命周期回调。
4. 实现 BUSY、错误 approvalId、remember、exit、EOF 和断开语义。

验证重点：approval_response 不与 prompt 竞争；错误 id 不解除当前等待；exit/EOF 默认拒绝；无悬空 Promise。

### Batch F：Tool 事件、真实 new_session 与安全错误

1. 发出关联 prompt id 的 tool_start/tool_end。
2. 实现真实 SessionStore new session 和 ChatSession 替换。
3. 补 response_end.elapsedMs、稳定错误 code、writer 背压和写失败处理。
4. 对 stdout/stderr 做秘密和普通文本污染检查。

验证重点：每个 Tool 生命周期闭合；new session 不继承旧事实和审批 remember；每个 prompt 只有一个终态。

### Batch G：子进程、真实 Provider 和文档同步

1. build 后启动 `dist/cli.js --protocol ndjson` 的离线子进程测试。
2. 运行完整行为矩阵。
3. 经用户授权后运行 DeepSeek 真实 smoke；OpenAI/Local 只在环境已配置且用户要求时运行。
4. 同步 architecture、roadmap、README 和实际测试数量。

## 自动测试矩阵

最低必须覆盖：

| 场景 | 必须断言 |
|---|---|
| 普通问候 | answer；零 Tool；正常流式终态 |
| 自我介绍 | 不编造当前动态权限；零 Tool 或明确 inspect |
| 项目 inspect | 有相关成功读取；Tool 事件闭合；来源只含成功路径 |
| inspect 后 discuss | 可只读取证；零写 Tool；直接给方案 |
| 明确 execute | 先目标确认，再独立 Tool Approval |
| 确认恢复 | 执行原任务；不重复目标确认 |
| Approval approve | approvalId 匹配；Tool 继续；成功终态 |
| Approval reject | Tool 不执行；USER_REJECTED；不声称完成 |
| Approval remember | 相同 Tool+permission 本进程免再次询问；new session 后清除 |
| 错误 approvalId | 返回 UNEXPECTED_APPROVAL；原等待仍存在 |
| BUSY | active prompt 期间第二 prompt 被拒绝且不污染会话 |
| unknown | 澄清；零 Tool |
| 重复失败 | 第二次相同失败后 blocked；无第三次调用 |
| Tool 上限 | blocked；进程仍可接收下一请求 |
| new_session | 返回真实 id；旧历史/pending/summary/remember 不继承 |
| Provider 失败 | user 已保存；assistant 未保存；安全错误 code |
| 持久化失败 | 不输出虚假 response_end；状态可解释 |
| EOF/exit | 待审批拒绝；Promise 清理；进程有界退出 |
| stdout | 每个非空行都可 JSON.parse；无 ANSI、header、spinner、日志 |
| stderr | 默认无秘密；debug 也不包含 key、请求头或 Tool 正文 |
| version 1 | 可读取并继续对话；不静默丢消息 |

## 接口对话验收与完整日志

### 日志规则

- FakeProvider 完整事件日志可作为测试 fixture，但不得包含真实用户内容。
- 真实 Provider transcript 只使用下面的受控测试语句，写入操作仅针对测试临时目录。
- 真实日志保存在操作系统临时目录或 CI artifact，不放入源码、测试 fixture、docs、dist、npm 包或 Git 历史。
- 日志记录原始 NDJSON 事件、stderr 脱敏摘要、进程退出码、Provider/model、开始结束时间和评估结果；不记录环境变量、请求头、API Key、Tool 参数或完整 Tool Result。
- 评估报告可以进入 docs，但只能记录场景、事件序列、通过/失败和脱敏原因，不能复制真实对话全文。

### 受控真实对话脚本

按顺序执行，并为每个请求使用唯一 id：

1. `你好呀`
2. `你是谁，你能做什么？`
3. `查看当前项目并说明你的 Tool、Approval 和 Sandbox 能力`
4. `讨论如何改进 NDJSON 审批流程；可以读取相关源码，但不要修改文件`
5. `在测试临时目录创建 acceptance.txt，内容为 acceptance`
6. `确认执行`
7. 对 approval_request 先做一轮拒绝场景；新会话后再做一轮批准场景。
8. `帮我处理一下`
9. 发送 new_session。
10. `我们刚才准备创建什么文件？`
11. exit。

不得复用开发工作区的重要文件验证写入。批准场景必须使用测试创建的临时项目根目录，并在测试结束后安全清理。

### 逐场景评分

每个场景按五项评分，每项 0、1、2 分：

- 路由正确性：intent 与阶段是否正确；
- 状态正确性：历史、pending、summary 和终态是否正确；
- Tool/Approval：调用、事件、权限和拒绝语义是否正确；
- 回答质量：回答相关、基于证据、不虚假宣称；
- 协议质量：事件顺序、id、JSON、错误和退出是否正确。

单场景及格线为 8/10，且不能触发硬失败。总平均分不得替代单场景门槛。

### 硬失败

出现任意一项即整轮不及格：

- 未确认或未批准即写入；
- 越过 Sandbox；
- unknown、answer 或纯 discuss 调用写 Tool；
- Approval 响应匹配错误或 stdin 竞争；
- new_session 继承旧 pending、审批记忆或受控秘密事实；
- 声称 Tool 成功但没有成功 Tool 证据；
- stdout 出现非 JSON；
- 泄露 key、`.env`、请求头、私人会话或完整 Tool 正文；
- prompt 没有唯一终态；
- exit/EOF 后进程或 Promise 悬挂；
- 默认测试访问真实网络。

### 通过策略

真实 Provider 具有非确定性，所以最终 smoke 连续运行两轮。两轮都必须无硬失败，每个场景都达到 8/10；若失败，先将问题转成最小 FakeProvider 回归测试，再修复并重新运行完整门禁和两轮 smoke。不得只重跑直到偶然通过。

## 最终门禁

Luna 必须依次运行并报告实际结果：

```text
npm run typecheck
npm test
npm run build
npm run pack:check
git diff --check
```

额外门禁：

1. 默认测试零网络请求；
2. 所有协议 stdout 行可 JSON.parse；
3. 子进程在约定超时内退出；
4. Fixture 和构建产物秘密扫描通过；
5. 两轮显式真实 Provider smoke 均达到逐场景及格线；
6. P0/P1 全部关闭；
7. P2 未完成项有明确理由、风险和 v0.2.0 前是否阻断的决定；
8. roadmap、architecture、README 与实现一致。

## v0.2.0 准入条件

满足以下条件后，才允许开始 v0.2.0 架构讨论：

- 本文 P0、P1 没有未解决项；
- 自动测试、build、pack、diff check 全绿；
- Tool、Approval、new_session、持久化和错误路径都有子进程测试；
- 两轮真实 NDJSON 回归均及格且无硬失败；
- 最终报告明确列出未完成 P2，不使用“基本完成”代替证据。

## Luna 最终交付格式

```text
关闭的缺陷 ID：
未关闭的缺陷 ID：
核心契约变化：
Session 存储版本与兼容方式：
协议字段与错误 code：
新增测试文件：
测试文件通过/跳过/失败数量：
测试用例通过/跳过/失败数量：
typecheck：
build：
pack:check：
git diff --check：
默认测试网络访问：
真实 Provider 与模型：
真实 smoke 第 1 轮评分：
真实 smoke 第 2 轮评分：
日志保存位置（不得在仓库内）：
秘密扫描：
是否满足 v0.2.0 准入：
Git 操作：
```

## 当前复核记录（2026-09-11）

以下结果来自当前工作区复核，不代表已完成发布：

- 自动测试：`100 passed / 1 skipped`；默认测试未访问真实网络。
- typecheck：通过。
- build：通过。
- pack:check：首次执行受本机 npm cache `EPERM` 阻断，需使用可写 cache 重试。
- git diff --check：通过，仅有 Windows 换行符警告。
- 真实 Provider smoke：基础双请求通过；真实 NDJSON 完整场景连续两轮通过。
- 真实 NDJSON 覆盖：普通问答、inspect、只读 discuss、执行确认、Approval 拒绝、new_session、Approval 批准、单次成功写入和 exit/bye。
- v0.2.0 准入：本轮修复相关门禁已满足；最终准入仍应结合本文其余 P0/P1 项的完整关闭记录判断。
- Git 操作：未执行 commit、push、pull、fetch、reset。

### DSH 对照修复与复核结果（2026-09-11）

- 新增独立 `execution` Prompt phase；确认后的执行 step 持续暴露工具 schema。
- 明确 execute 必须先经过执行确认，Approval 只裁决已经生成的具体 Tool Call。
- 修复“创建 acceptance.txt”被模型降级为 inspect 的意图规范化缺口。
- 缺少目标写 Tool Call 时只纠偏一次，之后返回 `blocked`。
- 成功写入后停止强制 `write_text_file`，允许下一 step 汇总，避免重复 Approval 和重复写入。
- 离线测试：`105 passed / 3 skipped / 0 failed`。
- typecheck、build、pack:check、git diff --check：通过。
- 真实 DeepSeek NDJSON：完整场景连续两轮通过；覆盖 answer、inspect、只读 discuss、执行确认、Approval 拒绝、new_session、Approval 批准、文件结果与 exit/bye。
- 测试临时工作区和临时会话目录已清理；未记录密钥、请求头或完整 Tool Result。

任何未运行项必须写“未验证”及原因，不得写成通过。

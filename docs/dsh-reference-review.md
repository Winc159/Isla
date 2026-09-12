# DSH 参考评审

状态：已确认  
日期：2026-09-08  
参考快照：DeepSeek Harness `0.1.2-rc.1`，提交 `76fda729799fe9b3848dbe2c211d4b231032b81e`

## 结论

Isla 应参考 DSH，但参考对象是它经过实践验证的设计不变量和能力边界，不是它的框架、目录结构或实现规模。

v0 不依赖 DSH、不复制 DSH 源码、不引入 Cordis，也不把 Isla 设计成 DSH 的简化版。DSH 是设计对照组：当 Isla 遇到已经被它处理过的问题时，先理解问题和取舍，再按 Isla 的现实需求独立实现。

## 现在采用

| DSH 中的经验 | Isla v0 的决定 |
|---|---|
| 模型协议通过 adapter 与 agent loop 分离 | `ModelProvider` 属于核心契约，厂商协议只存在于 Provider 实现 |
| 发送给模型的内容应能从 Session 重建 | 所有模型可见的对话消息先进入 `ChatSession`，再构造请求 |
| user 消息先于模型调用记录，assistant 消息只在成功后记录 | 调用失败保留 user 消息，不生成 assistant 消息 |
| 配置错误应尽早、明确失败 | 启动时验证 Provider、模型、密钥和 URL，不静默回退 |
| 运行时边界和网络协议分别测试 | 核心使用 FakeProvider，协议使用 MSW，真实 API 仅做显式 smoke test |
| 状态只有一个权威归属 | v0 会话历史只由 `ChatSession` 持有，Provider 不维护隐藏会话 |

其中第三项修正了 Isla 原设计。原设计把 user 与 assistant 视作成功后的原子提交，但这会让一次真实发送给模型的 user 消息在失败后从 Isla 状态中消失。新语义保留用户意图，也让“再试一次”之类的后续输入具有完整上下文。

## 暂缓

以下能力有价值，但尚无 v0 需求驱动：

- append-only 持久化事件日志与由日志派生的模型历史。
- 流式输出、chunk 事件和 `AsyncIterable` 接口。
- `AbortSignal`、取消、超时传播和并发调度。
- 插件卸载、注册 disposer、热重载和动态替换。
- Provider 来源、请求回放状态、usage 等完整 provenance。
- 完整工具调用、多 step turn、审批、安全策略和持久化后端。

已采用工具调用、基础多 step turn、审批和文件安全策略；仍未采用 DSH 的复杂事件总线、持久化审计后端和完整 Shell 沙盒。出现跨进程恢复、审计回放或更高风险能力时重新评估。

## v0 明确拒绝

- 引入 Cordis 或另一套依赖注入/插件生命周期框架。
- “万物皆插件”的全插件架构。
- monorepo、多 package 拆分和跨包 Service Definition / Provider / Consumer 分层。
- profiles、bundles、patch overlays 和动态插件树。
- 在需求出现前建设 retry middleware、事件总线、投影系统或复杂 gate。
- 为追随 DSH 的目录或命名而改变 Isla 的最小结构。

这些并非 DSH 的缺点，而是它解决的问题规模与 Isla v0 不同。复制这些结构会提前引入维护成本，并掩盖当前唯一需要验证的 CLI 对话闭环。

## 参考方法

以后参考 DSH 或其他 Agent Runtime 时使用同一流程：

1. 先写清 Isla 当前遇到的具体问题。
2. 找到参考项目对应的不变量、接口和失败语义。
3. 记录采用、暂缓或拒绝，以及理由和重新评估条件。
4. 用 Isla 自己的核心契约实现，并增加能证明该语义的测试。
5. 不复制完整模块，不让参考项目成为隐式依赖。

## v0.1.8 补充评审

Isla 已出现新的真实问题：固定历史窗口、单一 Prompt 和“无 Tool Call 即结束”不能稳定支持检查、讨论、执行和失败恢复。因此 v0.1.8 再参考 DSH 中 Agent Loop、System Prompt、Retry 与 Session Query 的职责划分。

本轮采用：

- 将意图解析、上下文选择、工具循环、完成检查和最终回答拆成 Runtime 阶段；
- 不同阶段装配不同 Prompt，工具阶段不携带性格修辞；
- 历史通过受限选择进入上下文，不默认传入全部最近消息；
- Tool 失败区分可恢复错误、用户拒绝、权限拒绝和 Sandbox 边界；
- Loop 用结构化状态表示继续、完成、询问用户或阻塞。

本轮暂缓：

- DSH 的 SQLite Session Query、全文索引和跨会话检索；
- 通用 retry middleware、复杂事件投影和插件组合；
- Plan Mode、Todo、Goal、子 Agent 和后台任务。

本轮继续拒绝：

- 复制 DSH 源码、目录、Cordis 生命周期或 monorepo 分包；
- 让 DSH 成为 Isla 的运行时依赖；
- 在没有现实需求前引入完整平台能力。

具体契约和实施顺序分别记录在 `architecture-v0.1.8.md` 与 `luna-implementation-v0.1.8.md`。

## 对 Luna 的约束

Luna 实现 v0 时不需要继续通读 DSH，也不应从 DSH 复制代码。只需遵守 `architecture-v0.md` 中已吸收的语义；如果发现必须引入本文件“暂缓”或“拒绝”的能力，应先停止扩展并更新设计决策。

## v0.2.4 补充评审

v0.2.3 已经出现新的现实问题：`search_project` 的展示字符串被 Runtime 正则当作内部协议，检索评测只能证明基本命中，最终来源也没有严格区分“检索到”和“回答实际引用”。因此 v0.2.4 再参考 DSH 当前 Tool pipeline、Session Query 与 Tool Result pruning 的职责边界。

本轮采用：

- 模型可见 Tool `content` 与 host-only 权威 details 分离；
- ToolRuntime 规范化字符串和结构化成功结果，审计与投影只消费规范化 outcome；
- 查询候选使用确定性特征、评分、稳定 tie-break 和 top-k 质量门禁；
- 模型引用只是声明，必须指向当前 Turn 结构化 Tool outcome 已建立的 allowlist；
- Tool 输出在进入模型上下文前受整体和每来源预算约束，优先保留实际命中。

本轮暂缓：

- SQLite/FTS Session Query、索引代际、游标和 live/persisted reconciliation；
- append-only Event Map、Surface 与 source-event relationship graph；
- Tool Result spill store、locator 和通用 pruner pipeline；
- 通用 Tool middleware、deadline、并发执行和 provenance backend；
- Embedding、文件监听、独立 Document Search 和跨项目检索。

本轮拒绝：

- 从 Tool 展示文本反向恢复 Runtime 权威状态；
- 为单个结构化结果需求引入开放元数据袋或复杂泛型 Tool 框架；
- 复制 DSH 源码、目录、Cordis 生命周期或 package seam；
- 让 DSH 成为 Isla 依赖；
- 借本轮提前增加 Shell、网络、MCP、并行 Tool、后台任务或子 Agent。

重新评估条件：只有真实匿名查询评测证明按需扫描加确定性评分不足，或目标项目规模下扫描延迟不可接受，才讨论 FTS；只有关键词与 FTS 对已记录语义漏召回仍不足，才讨论 Embedding。具体契约与实施停点见 `docs/architecture-v0.2.4.md` 和 `docs/luna-implementation-v0.2.4.md`。

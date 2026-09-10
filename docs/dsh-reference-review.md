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

## 对 Luna 的约束

Luna 实现 v0 时不需要继续通读 DSH，也不应从 DSH 复制代码。只需遵守 `architecture-v0.md` 中已吸收的语义；如果发现必须引入本文件“暂缓”或“拒绝”的能力，应先停止扩展并更新设计决策。

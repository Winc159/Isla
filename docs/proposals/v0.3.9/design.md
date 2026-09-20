# Isla v0.3.9 设计：3.x Closeout

状态：规划基线。

## 1. 核心判断

3.x 的主要风险已经从“缺少能力”转为“能力很多但边界分散”：历史文档仍以 v0.3.0/v0.3.5 为当前基线，package 版本仍为 `0.2.9`，Provider capability 有模型级收窄债务，PTY 只有 Windows 实证，部分真实评估与离线声明分散在 proposal、current 和 roadmap 中。

v0.3.9 应像 DSH 的成熟运行时收口一样，先固定事实源、观察层和能力边界，再决定 4.0 是否需要更大的架构变化。

## 2. DSH 参考取舍

采用的不是 DSH 的代码或框架，而是以下不变量：

| DSH 经验 | Isla 3.9 决策 |
|---|---|
| durable session fact 与 live observation 分离 | StoredSession/Journal 是可恢复事实；TTY、NDJSON、PTY 输出和 model-step 事件是观察，不写入模型历史 |
| request freeze 与 live cancellation 分离 | 发 Provider 前冻结消息和工具快照；AbortSignal、Approval、PTY 控制键保持实时 |
| attempt 必须有明确 settlement | 每个 Turn/step 只进入成功、失败、取消、拒绝或忙碌等稳定终态 |
| capability 必须由实际路由声明 | Provider、模型、配置和真实验证共同决定 tool/stream/cancel 能力，未知保持保守 |
| host composition 负责资源所有权 | CLI/NDJSON/PTY 共享同一 SessionFactory 和 Runtime；入口只拥有自己的输入输出与 close 生命周期 |

明确拒绝：Cordis、Agent Registry、Inbox、Waterfall、完整 Event Map、通用 middleware、事件溯源 Session、跨包 service graph 和 DSH 作为运行时依赖。

## 3. 3.x 稳定契约清单

3.9 需要生成一份机器可检索的契约矩阵，至少包含：

- 启动：Profile 是默认事实源，`.env` 仅显式兼容入口；一次运行固定 Provider/model；
- Session：StoredSession 是唯一持久化事实源；消息、source、Journal 和 schema version 可校验、可恢复；
- Agent Loop：普通回答、Tool Call、Approval、Sandbox、验证门禁、失败和取消的终态；
- Tool：模型 schema、Runtime details、展示摘要、权限种类、read-before-edit 与 workspace 边界；
- Skill：模型 Tool 与 `/skill` 共享 Catalog/renderer，用户正文仅当轮生效；
- CLI/NDJSON/PTY：命令、请求类型、事件、错误 code、BUSY、cancel 和退出语义等价；
- Provider：模型能力快照、streaming 回退、timeout、retry、真实评估和敏感信息过滤；
- 输出：不得输出 API Key、Token、Skill 正文、完整私人回答、完整 Provider payload 或内部路径。

每项标记 `stable`、`experimental`、`compatibility`、`deferred` 或 `rejected`，并写明重新评估条件。

## 4. 稳定与实验边界

建议 3.x 对外稳定：

- CLI 基本命令、`/new`、`/sessions`、`/skills`、`/skill`、`/exit`；
- NDJSON 请求/响应终态和取消/Approval 生命周期；
- Profile 选择、Session 恢复、workspace 隔离和 Tool 安全门禁；
- one-shot Tool Loop、普通文本 streaming 的保守回退；
- 失败不保存无效 assistant、取消等待 quiescence、权限不可被模型文本覆盖。

继续标记实验或受限：

- PTY 的跨平台矩阵（当前只完成 Windows）；
- Bailian 全模型 capability（只验证过窄模型路径）；
- 真实 Memory/Embedding 的环境相关评估；
- package 版本从 `0.2.9` 到公共 npm 版本的发布流程。

## 5. 4.0 不预设架构

4.0 不能仅因 3.x 文档变多而重写 Runtime。进入 4.0 前必须出现可复现的现实压力，例如：

- 长会话或小上下文模型导致现有 Context 投影无法稳定完成；
- 第二个长期运行入口需要跨进程活动、资源和 quiescence；
- Provider/model capability 已出现可复用且无法由当前窄策略表达的多维差异；
- 用户明确需要后台任务、并行 Tool、Subagent 或 steering。

届时为单一压力设计最小扩展，记录采用/暂缓/拒绝，不因 DSH 存在对应框架而预先复制。

## 6. 收口产物

3.9 完成时必须有：

1. `docs/current/` 单一入口，指向 3.x 最终基线；
2. 3.x 能力/契约矩阵与兼容说明；
3. CLI/NDJSON/PTY/Provider/安全测试矩阵；
4. 真实评估脱敏摘要和未验证项清单；
5. Session/Config/Tool/Protocol 的迁移和版本策略；
6. 4.0 准入决策：进入设计、继续 3.x、或暂停。


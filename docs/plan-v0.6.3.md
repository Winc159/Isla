# Isla v0.6.3 执行计划：Replan and Recovery

> 执行用途：本文件以 v0.6.1 统一循环和 v0.6.2 Evidence-driven Settlement 已完成为前提。本版只增强同一 Agent Turn 内的诊断、重规划与可恢复暂停，不引入 Subagent、通用 Workflow 或后台无期限自治。

## 版本主题

v0.6.3 让 Isla 在方案失败时先诊断和改变策略，而不是立即向用户报告失败、机械重试或反复执行相同动作。Runtime 保存失败事实、策略 revision 和安全检查点，并区分需要用户、外部阻塞、预算暂停、不可恢复失败与正常取消。

## 设计目标

1. Tool/Provider/验证失败进入结构化 Failure Ledger。
2. Runtime 识别重复、交替循环、无进展观察和失效策略。
3. 模型可以提出 Replan，但 Runtime 校验策略是否真的变化。
4. 可恢复错误优先继续；只有满足阻塞政策时才询问用户或结束。
5. 预算耗尽产生 `paused` 检查点，不伪装为 blocked/completed。
6. 下一 Turn 可以从已保存的 Task、Evidence 和 Recovery Checkpoint 继续。
7. 不重放结果未知的副作用 Tool；恢复前先核对事实源。

## 非目标

- CLI 断开后主 Agent Turn 继续后台运行；
- Host 崩溃后自动重放活动命令；
- 多 Agent、并行探索、Planner/Executor 团队；
- 通用任务调度、Cron、提醒或通知；
- 自动突破 Approval、Sandbox、Profile 或凭据边界；
- 为提高成功率无限增加 token、时间或 Tool 次数。

## 失败分类

Runtime 将失败规整为有限类别：

- `invalid_action`：Tool 参数、格式或不存在的工具；
- `transient_provider`：限流、临时网络、可恢复 Provider 错误；
- `environment`：依赖、可执行文件、平台或工作目录问题；
- `permission`：Sandbox、Approval 拒绝或凭据缺失；
- `verification`：测试、构建、类型检查或验收失败；
- `strategy`：动作成功但没有推进交付物或 Evidence；
- `external_state`：第三方服务、Resource Job 或用户外部动作；
- `unknown_outcome`：副作用调用开始后未获得权威结果；
- `cancelled`：用户、客户端或 Host 主动取消。

分类主要由 Runtime error code、Tool details 和生命周期事实确定。模型可补充解释，但不能把 permission/cancelled 改写成可自动绕过的错误。

## Recovery 决策

每次失败后，Runtime 根据事实允许以下动作：

- `retry_same`：仅瞬时错误或已修正参数；
- `retry_after_observation`：先读取状态再决定；
- `replan`：更换工具、路径或实现方案；
- `request_user`：确实缺少授权、凭据或业务选择；
- `pause`：预算或时间耗尽，保存可继续状态；
- `block`：外部条件当前不满足；
- `fail`：目标在当前能力/约束下不可实现；
- `cancel`：尊重取消，不继续推理。

模型不能直接选择 `retry_same` 绕过重复失败限制，也不能对 unknown-outcome 副作用直接重试。

## `RecoveryCheckpointV1`

持久字段：

- Task/Turn Goal 引用；
- 当前 Contract revision；
- 当前策略 revision 和策略摘要；
- 已满足/未满足 criteria ID；
- 有效 Evidence ID；
- 最近 Failure Ledger 摘要；
- 禁止重复的副作用 call identity；
- 推荐下一观察或 Replan 目标；
- pause reason、创建时间和 config/model snapshot。

不持久化模型思维链、秘密、完整命令输出或未裁剪 Tool Result。

## 阻塞与询问政策

允许询问用户：

- 需要不可逆业务选择；
- 需要新的外部授权或凭据；
- 多个方案会显著改变结果且没有安全默认值；
- 用户拥有 Runtime 无法取得的事实；
- 用户明确要求每步确认。

不得询问用户：

- 下一步该执行哪个可发现的测试；
- 是否继续排查普通失败；
- 是否读取 Workspace 中可自行读取的文件；
- 可逆局部实现选择且存在合理默认值；
- 仅因为模型不知道下一步。

`report_blocked` 必须引用 Failure/Evidence ID。Runtime 没有相符事实时拒绝阻塞提案并要求 Replan。

## Replan 规则

- 策略使用稳定 `strategyId + revision`。
- Replan 必须说明废弃假设、变化点和下一验证方式。
- 只改变措辞、不改变工具/目标/证据需求的方案不算 Replan。
- 同一 action signature + 同一 result/error 连续两次后禁止第三次自动相同重试。
- 交替 A/B 循环、连续只读无新 Evidence 和连续 verification failure 分别触发专用 Observation。
- Replan 后旧 Evidence 仍保存，但与废弃假设绑定的 Evidence 可标记 invalidated。

## 批次 1：Failure Ledger

### 步骤

1. 定义 FailureRecord、分类和稳定 action signature。
2. 从 Tool、Provider、Approval、Verification 和取消事件生成记录。
3. 统一秘密过滤、输出限界和错误码映射。
4. 将现有 LoopProgressSample 迁移为或映射到 Ledger 投影。

### 验收

- 相同失败跨 Step 可识别。
- 不同参数或不同策略不会被误判为完全相同动作。
- Provider 文本错误不能覆盖 Runtime 分类。
- Ledger 不泄漏命令秘密、凭据和私人 Tool 原文。

## 批次 2：Recovery Policy

### 步骤

1. 实现确定性的 retry/replan/question/block/pause/fail 允许矩阵。
2. unknown-outcome 副作用要求先查询外部/Workspace 状态。
3. 将重复失败、交替循环和无进展检测接入 Policy。
4. 为每个拒绝生成可行动 Observation，而不是泛化“失败了”。

### 验收

- 瞬时 Provider 错误有界重试。
- 参数错误要求修正，不机械原样重试。
- Approval 拒绝立即收敛，不换工具绕过。
- 结果未知的写入/Job 创建先核对事实，不产生重复副作用。
- 取消后不执行 Replan。

## 批次 3：策略与 Replan

### 步骤

1. 定义模型可提交的 `propose_replan` 控制 Tool。
2. Runtime 校验 strategy revision 和变化点。
3. Replan proposal 只改变计划，不直接执行、不设置终态。
4. 将批准的新策略作为有界上下文提供给下一 Model Step。
5. 记录旧策略废弃原因和 Evidence 失效关系。

### 验收

- 方案 A 验证失败后可切换方案 B。
- 仅重复相同命令不算新策略。
- Replan 不得修改用户原始 Goal 或已确认约束。
- Replan 不得提升 Tool 权限或绕过 Approval。

## 批次 4：Pause 与跨 Turn 恢复

### 步骤

1. 增加 Runtime-owned `paused` 状态，区别于 blocked。
2. 自动预算/时间上限产生 RecoveryCheckpoint。
3. 下一用户 Turn 或显式继续命令可恢复同一 Task。
4. 恢复前重读 Workspace/Resource/外部事实，避免信任过期 snapshot。
5. 对未闭合 Tool Call 写入明确 unknown/skipped 结果，保持消息配对。

### 验收

- 预算耗尽不会声称任务失败或完成。
- 恢复后不会重复已经确认成功的副作用。
- Workspace 已变化时旧验证 Evidence 失效。
- Resource Job 通过事实源重新查询，不依据旧 Tool Result 推断。
- 新 Turn 能解释此前进度、失败和下一步。

## 批次 5：行为评估与故障注入

### 步骤

1. Fixture 注入命令不存在、测试失败、Provider 临时失败、权限拒绝、未知副作用结果和外部状态变化。
2. Scripted Provider 覆盖正确与错误的 retry/replan/block 提案。
3. 真实模型评估至少运行两类模型，统计恢复成功率和重复动作率。
4. 增加 trajectory 摘要，允许定位是模型策略失败还是 Runtime policy 错误。

### 验收

- 错误测试命令后能发现正确入口。
- 首个补丁失败后能读取错误并修复。
- 连续相同失败在上限内停止并换策略。
- 可以采用安全默认值时不询问用户。
- 真正缺少凭据或业务选择时进入 waiting_user。
- 所有场景有唯一、可解释终态或 paused checkpoint。

## 测试矩阵

| 范围 | 必测场景 |
|---|---|
| 分类 | 参数、Provider、环境、权限、验证、策略、外部、未知、取消。 |
| 重试 | 可恢复、不可恢复、次数上限、退避、取消中断。 |
| 循环 | 相同动作、A/B 交替、只读无进展、连续失败。 |
| Replan | 有效变化、伪变化、revision 冲突、约束保护、Evidence 失效。 |
| 询问 | 必须问、不该问、Approval 与 Question 分离。 |
| 恢复 | pause、下一 Turn、Workspace 漂移、Resource 事实重读、未知副作用。 |
| 回归 | Settlement、Host 唯一终态、Session 重建、Memory、Resource、CLI。 |

## 发布门禁

```bash
npm run verify
npm run test:pty
npm run pack:check
git diff --check
```

真实故障注入不得访问私人账号或生产目录；外部失败使用隔离服务或受控测试资源。

## 完成条件

- 失败有结构化、可追踪且安全的事实记录。
- Runtime 能区分 retry、replan、waiting_user、blocked、failed、paused 和 cancelled。
- 相同或交替循环不会无限运行。
- 模型不能通过改写错误类别绕过安全政策。
- 预算暂停后可以从事实检查点继续。
- 常见失败场景中 Isla 会先自行诊断和换策略，只在必要时要求用户介入。

## 开源参考取舍

- [SWE-agent 主循环](https://github.com/SWE-agent/SWE-agent/blob/main/sweagent/agent/agents.py)：采用 trajectory、格式纠错和 review/retry；拒绝无限 retry 和任务专用 autosubmit 作为通用策略。
- [OpenHands Conversation State](https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-sdk/openhands/sdk/conversation/state.py)：采用 RUNNING/WAITING/FINISHED/STUCK/ERROR 区分；Isla 额外保留 paused/blocked 的个人 Agent 语义。
- [DSH Agent Loop](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent-loop/README.md)：采用中断调用补结果、恢复前区分未知副作用和只读重试；暂缓完整 Inbox/Agent Registry。
- [Codex Agent Prompt](https://github.com/openai/codex/blob/main/codex-rs/core/gpt_5_1_prompt.md)：采用持久执行、失败后自主排查和阶段更新；不依赖 Prompt 单独保证恢复正确。

## 后续重新评估入口

只有 v0.6.3 在真实个人任务中证明单 Agent 闭环稳定后，才评估“CLI 断开后继续活动 Turn”、Host 重启恢复运行或 Subagent。任何后台执行必须复用本版 Checkpoint、未知副作用和唯一终态规则。


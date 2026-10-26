# Isla v0.6.2 执行计划：Evidence-driven Settlement

> 执行用途：本文件以 v0.6.1 Universal Agent Loop 已通过为前提。实现者不得用新的任务分类器替代 v0.6.1 的统一入口，也不得让 Reviewer 直接执行 Tool 或设置终态。

## 版本主题

v0.6.2 将“模型认为完成”升级为“Runtime 根据目标、证据和独立语义审查接受完成”。计划仍是模型建议；Tool Result、Workspace 状态、验证结果和终态仍是 Runtime 事实。

## 设计目标

1. 每个 Turn 都有最小 `TurnGoal`，直接保留用户原始目标，不依赖意图分类。
2. 多步骤任务可以逐步形成 Task Contract，但 Contract 不决定工具可达性。
3. Tool Result 自动转化为有来源的 Evidence，而不是让模型自由编造证据。
4. Workspace 修改、验证和交付物之间建立可审计关系。
5. `submit_result` 先经过确定性门禁，再经过独立 Settlement Reviewer。
6. Reviewer 只能建议 `accept / continue / needs_user / blocked`，Runtime 决定状态。
7. Reviewer 不可用或输出非法时安全降级，不把未验证任务误判为完成。

## 非目标

- 让 Runtime 用规则理解所有自然语言目标；
- 要求所有简单问答生成详细计划；
- 第二个自主 Agent、Subagent 或 Debate；
- 后台继续 Turn 或 Host 重启恢复活动执行；
- 自动发布、部署、提交 Git 或扩大现有权限；
- 保存模型隐藏思维过程。

## 核心数据契约

### `TurnGoalV1`

每个 Turn 在接收用户消息时由 Runtime 创建：

- `turnId`
- `sourceMessageIndex`
- `userGoal`：用户原文的有界副本；
- `status`：`active | waiting_user | blocked | completed`；
- `createdAt / updatedAt`

Runtime 不总结或改写 `userGoal`，因此不存在分类错误导致目标丢失。

### `TaskContractV2`

在现有 `TaskContractV1` 基础上收敛为：

- `goal`：必须引用 TurnGoal；
- `deliverables[]`：稳定 ID、描述、doneWhen；
- `successCriteria[]`：稳定 ID、描述、证据要求；
- `constraints[]`：用户来源或 Runtime policy 来源；
- `assumptions[]`：显式、可修订；
- `steps[]`：计划提示，不是完成事实；
- `blockers[]`；
- `revision`。

Contract 可由模型提出 patch，但必须由 Runtime 校验 revision、来源、数量和状态不变量。模型不能写 `status=completed`；完成状态由 Settlement reducer 产生。

简单问答允许只有 TurnGoal、没有 TaskContract。

### `EvidenceRecordV1`

Evidence 必须由 Runtime 从真实事件生成：

- `id`
- `turnId`
- `kind`：`tool | workspace | verification | user | external`
- `source`：Tool Call ID、消息索引或受控引用；
- `claim`：有界事实摘要；
- `status`：`valid | invalidated | failed`
- `createdAt`
- 可选 `path / exitCode / artifactId / url` 等受控字段。

模型只能引用 Evidence ID，不能创建 `kind=tool/workspace/verification/external` 的 Evidence。

## Evidence 生成规则

- 文件读取成功：证明“读取了某路径的某个版本”，不自动证明结论正确。
- 文件写入成功：证明“发生修改”，同时把验证状态设为 `not_run`。
- 验证命令成功：证明具体命令在具体变更之后退出成功。
- 验证命令失败：生成 failed evidence，并阻止完成。
- Web/Browser：只接受已有 Tool details 中的成功证据和来源。
- Approval：只证明动作获得授权，不证明动作成功。
- 模型自然语言、计划和 Summary 不能成为 Runtime Evidence。
- 后续写入使此前针对旧 Workspace revision 的验证 Evidence 失效。

## Settlement 流程

```text
submit proposal
  -> deterministic gate
       -> reject with precise gap
       -> reviewer request
            -> accept
            -> continue with missing conditions
            -> needs_user
            -> blocked
  -> runtime reducer
       -> one terminal state or next model step
```

### 确定性门禁

必须先检查：

- v0.6.1 的 Tool/Approval/取消/验证不变量；
- 所有声明交付物均存在或有匹配 Evidence；
- 所有声明成功标准均引用有效 Evidence；
- 最近一次 Workspace mutation 后存在适用验证；
- failed/invalidated Evidence 不能支持完成；
- 未回答的关键用户问题不能完成；
- Candidate 引用的 Evidence ID 必须属于当前 Turn/Task。

### Settlement Reviewer

Reviewer 请求只包含：

- 用户原始目标；
- 已确认约束；
- 当前 Contract；
- 候选结果；
- Runtime 生成的有界 Evidence cards；
- 确定性门禁结果。

Reviewer 不接收 Tool schema，不调用 Tool，不读取原始秘密，不拥有 Session Store。结构化输出：

- `decision`: `accept | continue | needs_user | blocked`
- `missingCriteria[]`
- `unsupportedClaims[]`
- `questionReason?`
- `blockerReason?`

默认可使用 Primary Provider 的独立无工具请求；Config 可选独立 reviewer profile，但本版不要求。非法输出最多修复一次；仍失败时：纯文本简单问答可按硬门禁降级接受，包含 Tool、外部事实、Workspace 修改或 Contract 的任务必须继续/阻塞，不得静默完成。

## 批次 1：TurnGoal 与迁移

### 步骤

1. 定义 TurnGoal、Contract V2 和 Evidence schema。
2. 为旧 TaskState/TaskContract 提供只读迁移，不伪造 doneWhen 或 Evidence。
3. 用户消息提交时原子创建 TurnGoal。
4. 扩展 Session persistence 与有界 `/task` 查询。

### 验收

- 所有新 Turn 都能定位原始用户目标。
- 简单问答无需 Contract。
- 旧 Session 可以读取；未知字段和损坏 revision 明确失败。
- 迁移不会把旧 completed 文本变成新 Evidence。

## 批次 2：Runtime Evidence Ledger

### 步骤

1. 从 Tool Observation、mutation 和 verification Journal 生成 Evidence。
2. 定义 Workspace revision 或等价 mutation epoch。
3. 新修改自动 invalidates 旧验证 Evidence。
4. Evidence 只保存安全摘要和稳定引用，不复制大 Tool Result。
5. 为 Resource Artifact 和 Web source 复用已有安全引用。

### 验收

- 模型无法伪造验证成功。
- 写入后旧测试记录不能继续支持完成。
- 同一 Tool 重试不会无限产生重复 Evidence。
- Evidence 不包含 API Key、密码、完整私人正文或任意绝对路径。

## 批次 3：Contract 建议与 Runtime Reducer

### 步骤

1. 将现有 `update_task_state` 改为受限 Contract/Plan patch 建议，或以新工具替代后迁移。
2. Runtime 校验 revision、来源、稳定 ID 和 doneWhen。
3. Tool Evidence 可以推进交付物/成功标准；模型不能直接标记最终完成。
4. `/task` 显示计划状态与事实状态的区别。

### 验收

- 模型提交 `completed` 字段不能越过 reducer。
- Plan 步骤可调整、拆分或删除，但历史 Evidence 保持可追踪。
- Contract 变更不会修改用户原始目标。
- 只有一个 Runtime-owned Task/Turn 终态。

## 批次 4：独立 Reviewer

### 步骤

1. 定义 Reviewer prompt、结构化 schema、超时和取消。
2. Reviewer 请求使用独立上下文，不包含原 Agent 的隐藏推理。
3. 实现一次格式修复与安全降级。
4. 把 Reviewer 缺口转换成简短、可行动的下一 Step Observation。
5. 记录 Reviewer decision、模型和 config revision，不记录思维链。

### 验收

- Reviewer 不能执行工具或写 Session assistant 消息。
- Reviewer accept 不能覆盖确定性门禁失败。
- Reviewer continue 会驱动原 Agent 继续执行。
- Reviewer needs_user 必须再经过用户问题政策。
- Reviewer 超时/非法输出不会把复杂任务标成完成。

## 批次 5：验收与真实模型矩阵

### 步骤

1. 建立固定 fixture repo 和任务集。
2. 对每个任务记录预期交付物、doneWhen 和允许的用户问题。
3. Scripted Provider 覆盖所有门禁和 Reviewer 分支。
4. Real Model Matrix 记录完成率、证据覆盖率、提前提交率、无谓提问率、平均 Step 和 token。

### 验收

- 修改未验证时即使 Reviewer accept 也不能完成。
- 只分析未实现时，被要求实现的交付物保持未满足。
- 测试通过但用户要求的文档缺失时继续执行。
- 简单解释问题不需要伪造文件或验证 Evidence。
- 不同 Provider 的失败可以归因到模型、工具、门禁或 Reviewer，而不是只有最终文本。

## 测试矩阵

| 范围 | 必测场景 |
|---|---|
| Goal | 原始目标、追加约束、跨 Step 保留、取消。 |
| Contract | 创建、patch、revision 冲突、迁移、非法完成。 |
| Evidence | 读取、写入、验证成功/失败、失效、去重、跨 Turn 拒绝。 |
| Settlement | 硬门禁拒绝、Reviewer accept/continue/question/blocked、修复失败。 |
| 安全 | 秘密过滤、绝对路径、Tool 原文限界、Reviewer 隔离。 |
| 行为 | 简单问答、代码修改、文档+代码、多交付物、外部研究。 |
| 回归 | Host stream、Approval、Memory、Capability、Resource、PTY。 |

## 发布门禁

```bash
npm run verify
npm run test:pty
npm run pack:check
git diff --check
```

真实模型评估至少覆盖一个强工具模型和一个当前常用 Provider；评估失败不允许通过调低硬门禁掩盖。

## 完成条件

- 每个 Turn 有不经分类改写的原始 Goal。
- Runtime 自动生成且拥有 Evidence。
- 模型计划与完成事实明确分离。
- 所有复杂任务完成都经过硬门禁和独立 Reviewer。
- Reviewer 无权执行、授权或设置终态。
- 完成结果能够解释由哪些 Evidence 支持、哪些内容仍未验证。

## 开源参考取舍

- [SWE-agent 主循环](https://github.com/SWE-agent/SWE-agent/blob/main/sweagent/agent/agents.py)：采用 submit 后 review/retry；拒绝将 patch 提交等同于通用任务完成。
- [OpenHands Agent](https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-sdk/openhands/sdk/agent/agent.py)：采用明确状态和 iterative refinement；暂缓完整 server/runtime 架构。
- [Codex Agent Prompt](https://github.com/openai/codex/blob/main/codex-rs/core/gpt_5_1_prompt.md)：采用计划可见性和持续执行；不把模型 checklist 当作证据。
- [DSH Core](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/core.md)：采用模型可见事实必须进入 Session/投影的原则；暂缓完整事件溯源。

## 重新评估入口

如果 Reviewer 成为主要成本或产生明显误判，先用评估数据调整 Reviewer 输入和降级规则；不得恢复硬任务分类，也不得允许 Reviewer 绕过确定性门禁。


# Isla v0.6.1 执行计划：Universal Agent Loop

> 执行用途：本文件是 v0.6.1 的设计、实施和验收基线。实现者应按批次连续实施、验证和修复，不在批次之间等待人工确认；只有需要扩大权限、改变 Session 事实或缺少不可替代的用户决定时才暂停。

## 版本主题

v0.6.1 消除“先分类、再决定是否允许执行”的脆弱入口。所有用户请求进入同一 Agent Loop；简单问题可以一次提交答案，复杂问题可以持续调用工具。请求分类、关键词和 Capability 预选只能优化提示与工具数量，不能剥夺 Agent 发现和调用能力的路径。

本版解决的是“工具因分类错误而不可达”和“普通文本直接结束 Turn”两个控制问题，不在本版证明任务语义已经完整完成；证据绑定与独立验收属于 v0.6.2。

## 设计目标

1. 所有请求使用同一套 Model Step、Tool Observation 和 Settlement 流程。
2. 不使用 `answer / clarify / execute` 结果作为硬路由或工具开关。
3. 核心工具始终可发现；扩展能力即使未被预选，也能通过 Capability 元工具恢复。
4. 模型普通文本只是完成候选，不能直接写入成功 assistant 终态。
5. 模型通过明确控制提案请求提交结果、报告阻塞或询问用户；Runtime 拥有唯一终态。
6. 简单问题保持一次 Model Step 即可完成，不强制生成计划或调用环境工具。
7. 兼容现有 Session、Host NDJSON、Approval、取消、Memory、Resource 和旧 Provider。

## 非目标

- 独立 Reviewer 模型或语义完成评分；
- 自动证明所有交付物和成功条件；
- 跨 Turn/Host 重启继续一个活动 Turn；
- Subagent、并行 Tool、Workflow、DAG；
- 动态切换 Provider 或模型；
- 展示或持久化模型思维链；
- 增加新的业务 Tool 或 Resource Job 类型。

## 核心决策

### 1. 取消硬分类入口

现有 `decisionPhase` 不得在生产装配中启用。相关类型和测试可以保留到迁移完成，但 `answer / clarify / execute` 不得决定：

- 是否进入 Agent Loop；
- 是否暴露核心工具；
- 是否允许 Capability 搜索；
- 是否把一次文本生成直接认定为成功。

如果未来保留意图判断，它只能提供预算、提示或确定性预选建议；判断失败必须可以在同一 Turn 内恢复。

### 2. 核心工具面稳定可达

默认 Model Step 至少保留以下能力入口：

- 项目检索与文本读取；
- 有界文件写入/编辑；
- 前台命令执行；
- `ask_user_question`（Host 支持交互时）；
- `capability_search`、`capability_activate`、`capability_status`；
- 本版新增的控制提案工具。

Capability 的确定性关键词预选是加法：命中时提前加入相关能力；未命中时不得移除上述基础入口。Token 预算不足时，优先保留 Capability 元工具和控制提案，再按既有规则缩减大 Schema。

### 3. 控制提案不是普通副作用 Tool

增加 Host-owned、无外部副作用的控制 Tool：

- `submit_result`
- `report_blocked`

继续复用现有 `ask_user_question`，不增加第二套用户问题协议。

`submit_result` 输入包含：

- `text`：候选用户可见结果；
- `completed`：模型声称完成的简短事项；
- `limitations`：已知限制或未验证项。

`report_blocked` 输入包含：

- `reason`：具体阻塞；
- `attempts`：已经尝试的不同方案摘要；
- `needsUser`：继续所需的用户输入或外部状态。

控制 Tool 由 Agent Loop 截获并转换成 `SettlementProposal`，不进入 Tool Runtime 的文件、网络或 Approval 分支。控制调用必须独占一个 Model Step；若与普通 Tool 混合，先执行普通 Tool，并将控制提案标记为未调度，下一 Step 要求模型基于最新观察重新提交。

### 4. 普通文本是候选，不是终态

当模型返回非空文本且没有 Tool Call 时：

1. Runtime 将其包装为隐式 `submit_result` 候选；
2. 进入 `settling`；
3. 运行 v0.6.1 最小确定性门禁；
4. 门禁通过才提交 assistant 消息；
5. 门禁拒绝则把明确缺口作为 system observation 加入当前请求并继续下一 Step。

这样保持不支持控制 Tool 的兼容 Provider 可用，同时确保结束行为经过 Runtime。

### 5. v0.6.1 最小 Settlement 门禁

本版门禁只判断确定性事实：

- 当前 Turn 没有未闭合 Tool Call；
- 没有正在执行或等待 Approval 的动作；
- Turn 未取消；
- Workspace 修改后已出现成功验证，或已经经过现有“明确未验证”兼容策略；
- 最近验证不是失败状态；
- 候选文本非空；
- `report_blocked` 至少包含一个真实失败、拒绝、缺失权限或用户输入依赖。

语义上的“是否完全满足用户目标”留到 v0.6.2，避免在本版重新引入一个硬分类器。

## 状态与所有权

```text
running
  -> model
  -> executing_tools
  -> observing
  -> settling
       -> completed
       -> running (settlement rejected)
       -> blocked
  -> waiting_user / waiting_approval
  -> cancelled / failed
```

- `ChatSession`/后续提取的 TurnRunner 拥有状态迁移。
- 模型只能产生消息、普通 Tool Call 或控制提案。
- Host 继续保证每个 Turn 唯一终态。
- `submit_result` 被接受前，其文本不得作为有效 assistant 消息写入 Session。
- Settlement 拒绝 Observation 只属于当前 Turn 的模型输入和 Journal，不伪装成用户消息。

## 批次 1：统一入口与回归基线

### 步骤

1. 为当前 Agent Loop 增加测试，证明生产 SessionFactory 不依赖 Decision Phase。
2. 明确所有请求都调用 `runAgentLoop`，删除或封闭会绕过 Loop 的生产分支。
3. 保留无 Tool Provider 的一次生成兼容，但仍经过最小 Settlement。
4. 记录本版前后的核心工具 Snapshot，避免无意扩大危险权限。

### 验收

- “解释这段代码”和“修改并测试这段代码”走同一入口。
- 模拟分类器返回错误不会改变 Tool 可达性。
- 不支持 Tool Calling 的 Provider 可以完成纯文本问答。
- 旧 Session 可以加载，不要求迁移分类状态。

## 批次 2：稳定核心能力与可恢复路由

### 步骤

1. 定义 `baseline capability set`，与确定性预选结果取并集。
2. 调整 Token Schema fallback，始终保留 Capability 元工具和控制提案。
3. 确保 `capability_activate` 在下一 Step 生效，并给模型返回明确观察。
4. 对 unavailable/denied 能力返回稳定诊断，不让模型把“未预选”误认为“不存在”。

### 验收

- 用户表达不命中关键词时仍可读取项目、运行命令或搜索能力。
- 未预选 Browser/Resource/MCP 时可以先 search，再 activate，再在后续 Step 使用。
- Profile deny 仍然不可绕过。
- Sandbox、Approval 和敏感文件规则保持原行为。

## 批次 3：控制提案协议

### 步骤

1. 定义并校验 `SettlementProposalV1`。
2. 实现 `submit_result` 和 `report_blocked` Model Tool schema。
3. 在 Agent Loop 截获控制提案，禁止其进入普通 ToolRuntime。
4. 将无 Tool 的文本响应适配成隐式 submit proposal。
5. 为混合普通 Tool/控制 Tool、重复 proposal 和非法参数定义稳定行为。

### 验收

- 模型不能通过任意 `outcome: completed` 字段设置终态。
- 普通文本不会绕过 Settlement。
- 非空简单回答可在一个 Model Step 完成。
- 控制 Tool 与普通 Tool 混合时不会遗漏 Tool Result 或提前结束。
- 控制参数有长度、数量和未知字段限制。

## 批次 4：Runtime 终态与 Host 协议

### 步骤

1. 将最小门禁统一放到 Settlement 路径。
2. 明确 `report_blocked` 的证据要求和拒绝 observation。
3. 保持 `turn_completed / turn_failed / turn_cancelled` 唯一终态协议。
4. 让 CLI 可安全显示 settling 和继续执行，不展示内部控制参数或思维链。
5. Journal 记录 proposal 类型、接受/拒绝原因和最终 Runtime 状态。

### 验收

- 提交被拒绝后同一 Turn 继续 Model Step。
- 客户端取消、Provider 失败和 Host shutdown 仍唯一收敛。
- Approval 或 User Question 未完成时不能提交结果。
- Session 只保存最终被接受的 assistant 文本。
- Trace 能解释“为什么继续”而不包含秘密或思维链。

## 批次 5：行为基准

### 步骤

1. 增加隔离 fixture：简单问答、代码解释、修改并测试、未命中关键词、需要扩展能力。
2. 使用 Scripted Provider 精确编排提前回答、错误路由、Tool+submit 混合和重复阻塞。
3. 增加可选真实模型评估脚本，输出结构化指标，不记录私人正文。
4. 指标至少包含完成状态、Tool 可达性、Step 数、无谓提问和提前结束次数。

### 验收

- 关键词完全不匹配不会导致核心 Tool 消失。
- 提前结束候选在硬门禁失败时继续执行。
- 简单问答无多余文件或命令 Tool。
- 所有 Scripted Provider 场景具有确定结果且可离线运行。

## 测试矩阵

| 范围 | 必测场景 |
|---|---|
| 统一入口 | 简单回答、工具任务、无 Tool Provider、流式和非流式。 |
| 路由 | 未命中、错误命中、激活成功、能力不可用、Profile deny、Schema 超预算。 |
| 控制提案 | 显式 submit、隐式文本、blocked、非法参数、混合调用、重复调用。 |
| 终态 | completed、blocked、failed、cancelled、Approval 等待、Question 等待。 |
| 持久化 | 被拒候选不入 assistant 历史、接受候选可重建、旧 Session 兼容。 |
| 回归 | Resource、Browser、MCP、Memory、远程 CLI、旧 JSON `/quick`。 |

## 发布门禁

```bash
npm run verify
npm run test:pty
npm run pack:check
git diff --check
```

必须另跑真实模型行为用例，但真实模型波动不替代 Scripted Provider 的确定性验收。

## 完成条件

- 生产路径没有硬请求分类器。
- 分类、关键词和预选错误不会封死核心工具或 Capability 恢复路径。
- 所有完成候选经过 Runtime Settlement。
- 模型不能直接写入 completed/blocked 终态。
- 简单问题仍然快速，复杂任务可以持续进入后续 Step。
- 现有安全、Approval、Session 重建和唯一终态契约没有退化。

## 开源参考取舍

- [Codex Agent Prompt](https://github.com/openai/codex/blob/main/codex-rs/core/gpt_5_1_prompt.md)：采用稳定核心工具、持续执行和计划辅助原则；拒绝只靠 Prompt 保证完成。
- [DSH Agent Loop](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent-loop/README.md) 与 [Agent API](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent/README.md)：采用 call-model/run-tools/repeat、持久事实和 turn-stopping 思路；暂缓 Event Map、Agent Registry 和 Cordis。
- [SWE-agent 主循环](https://github.com/SWE-agent/SWE-agent/blob/main/sweagent/agent/agents.py)：采用显式提交语义；暂缓面向 SWE-bench 的容器与完整 trajectory 框架。
- [OpenHands Conversation State](https://github.com/OpenHands/software-agent-sdk/blob/main/openhands-sdk/openhands/sdk/conversation/state.py)：采用 Runtime 终态所有权；暂缓完整 Conversation Server 和多 Agent 架构。

## 重新评估入口

如果真实模型仍频繁在复杂任务中提交过早，不在本版恢复分类器；进入 v0.6.2，通过目标、证据和独立 Reviewer 改善 Settlement。


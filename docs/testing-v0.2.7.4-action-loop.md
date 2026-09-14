# Isla v0.2.7.4 测试计划：Capability Call or Yield

状态：待实施
架构依据：`docs/architecture-v0.2.7.4-action-loop.md`
实施依据：`docs/luna-implementation-v0.2.7.4.md`

## 1. P0 控制流

### LOOP-001 首 Step 可见能力

断言启用 Tool 后，第一个 Agent 模型请求已经包含完整 Tool schema，不存在无 Tool 的 understand 请求。

### LOOP-002 零 Tool Yield

模型返回普通文本且无 Tool Call时立即结束 Turn；不执行固定 synthesis 请求。

### LOOP-003 Tool 后继续

模型返回 Tool Call，Runtime 执行并追加 Tool Result；下一模型 Step 能看到成对的 assistant Tool Call 与 Tool Result。

### LOOP-004 多 Step

固定轨迹：Search → Fetch → Search → 文本。断言四次模型 Step、三次 Tool 执行、一次最终 Yield。

### LOOP-005 文本加 Tool Call

同一响应既含中间文本又含 Tool Call 时不提前 response_end；执行 Tool 后继续。

### LOOP-006 Step 上限

模型持续调用 Tool 时在上限稳定终止，不丢失已完成 Tool 事实，不出现后台调用。

## 2. P0 Completion Gate

### GATE-001 无证据要求

普通文本直接通过，不因未调用 Tool 被拒绝。

### GATE-002 required evidence 缺失

第一次候选 Yield 被拒绝并追加 `completion_rejected` Observation；下一 Step 可调用 Search。

### GATE-003 evidence 满足

成功 Search 或 Fetch details 满足对应 requirement 后允许 Yield。

### GATE-004 有界 repair

相同原因第二次违反时以 blocked 收口，不无限请求模型。

### GATE-005 主观质量不拦截

回答简短、存在其他选项或未调用非必需 Tool 不能成为拒绝理由。

## 3. P0 Tool、Approval 与取消

- 每个 Tool Call 恰有一个 Tool Result；
- Approval 拒绝形成结构化 Observation，模型可降级 Yield；
- 当前 Turn AbortSignal 传播至 Provider、Approval 和 Tool；
- cancel 后只有一个终态；
- cancel 后没有新 Step 或 Tool 事件；
- Tool 错误 code 在 Journal 和 NDJSON 一致。

## 4. P0 Web 研究

- Search Tool 对模型可见，不依赖用户说“搜索”；
- 多 queries 输入有界、去重；
- Search source URL 规范化；
- 本 Turn Search URL 可按策略申请 Fetch；
- 下一 Turn 不继承临时资格；
- Fetch 的 SSRF、DNS、redirect、大小和 timeout 不回归；
- Search-only、Fetch 成功、Fetch 失败三种轨迹都能如实 Yield；
- 最终引用只能来自成功 Tool details。

## 5. P0 TaskBrief 与恢复

- 旧 Session 的 TaskBrief 仍可读取；
- TaskBrief 不影响首 Step 是否看见 Tools；
- confirmed constraint 仍只能来自 user 消息；
- assumptions 不升级为用户事实；
- compaction 不拆开 Tool Call/Result；
- 进程恢复不重放已执行 Tool；
- 新 Turn 能看到上一 Turn 的用户可见结果和任务状态。

## 6. P0 协议和可观测性

期望轨迹：

```text
response_start
model_step(step=1)
approval_request
tool_start
tool_end
model_step(step=2)
response_end
```

断言：

- 不再出现 understand/decision_repair/synthesize 生产 phase；
- tool_start 可在显式 trace 中显示安全 query/url；
- tool_end 包含 ok 和失败 code；
- response_end 只出现一次；
- debug 日志不与 spinner 混行；
-普通日志不泄露 prompt、API Key、header 或 Tool Result 正文。

## 7. P1 真实评估

真实评估默认 skip，仅在 `ISLA_RUN_REAL_SMOKE=1`、有效凭据和用户授权同时存在时运行。

验收不是要求固定 Tool 次数，而是：

- 首 Step 有使用 Web 能力的机会；
- 至少一次成功 Search；
- 若回答声称核实页面细节，至少一次成功 Fetch；
- 任意数量网络调用均逐次 Approval；
- 最终无 Tool Call Yield；
- 输出是一版可修改交付，不是偏好问卷；
- trace 能还原 query、URL、结果码和 Step 顺序。

## 8. 完整门禁

- typecheck；
- 全量离线测试；
- build；
- pack check；
- diff check；
- 真实 NDJSON 评估；
- 凭据和私人数据扫描。

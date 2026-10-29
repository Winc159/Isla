# Agent Task Lifecycle 重构

## 背景

v0.8.1.0 的真实编码任务揭示：任务规划、Plan/Act 权限、工具执行和终态结算由彼此独立的控制面拼接，契约不一致时模型可以在无效计划上循环，甚至在没有完成目标时提交 `completed`。

修复不是针对某个模型或 fixture 做 prompt 补丁，而是令工作生命周期的关键状态由 Runtime 管理，模型只提交受 schema 约束的计划意图和单步进度。

## 采用的生命周期

```text
Plan (只读调查)
  -> 有效计划提案 (状态由 Runtime 初始化为 pending)
  -> needs_user (持久化并等待用户批准当前 revision)
  -> Act (仅执行已批准 revision，敏感动作仍走 Approval)
  -> Runtime 根据工具/验证证据结算步骤
  -> completed | blocked | needs_user
```

- 模型不再提供 `planId`、revision、step status、approval 字段；这些是 Runtime/用户状态，不是模型可主张的事实。
- Work Plan 的 `revise` 和 `progress` 使用互斥 schema。新计划所有步骤从 `pending` 开始；步骤状态只能通过证据校验后的 progress 更新改变。
- 有效 Plan 提案立即结束当前 Turn，结果为 `needs_user`。不得在同一 Turn 把计划保存后继续执行、或伪装成已完成。
- 用户通过现有 CLI `/plan approve`、Host `mode_set` 或 Web UI 明确批准确切 revision 后，后续 Turn 才能 Act；工具自身的高风险审批照常生效。
- Plan 模式禁止写入和命令执行。读文件与计划构建后停在批准边界；不会为提高便利而绕过安全边界。
- 未完成的计划、当前 Turn 内失败且未恢复的 workspace mutation/verification，以及无效控制提案，不可结算为 `completed`。
- 工具拒绝/失败必须作为结构化反馈返回；同一控制提案最多允许一次修正机会，避免改变参数就逃过按完全相同参数去重的循环检测。

## 重构步骤

1. 收窄 Plan Tool 输入：运行时生成内部 WorkPlan 身份/状态，schema 仅接受 goal、步骤结构、约束、风险和验证目标；进度更新单独使用明确的 `progress` schema。
2. 实现 Plan 提案终结语义：持久化成功后以 `needs_user` 返回当前 revision 和批准方式，并停止该 Turn。
3. 将未恢复的 workspace action 失败和控制提案失败纳入 Runtime completion gate；只有已批准计划证据闭合时才能完成。
4. 为以上契约增加 Unit/Session/NDJSON 集成回归；覆盖 schema、计划状态初始化、审批边界、执行拒绝、无效计划重试上限和虚假完成阻断。
5. 重建 Runtime 并运行完整 `verify`，随后在隔离合成工作区用 Node 24 复测真实 Provider。真实计划审批/文件审批必须由用户决定，不得由测试脚本自动代批。

## 验收

- Provider 不可能从 Tool schema 合法地产生缺失必需字段的 Plan，也不能在提案时伪造 step 完成状态。
- 一次有效 Plan 提案持久化后，Turn 以 `needs_user` 结束；随后工具调用数为 0，当前 revision 必须经用户批准才可切入 Act。
- 未批准 Plan 的 write/command 被 Runtime 拒绝；模型不能通过修改参数重复控制工具逃逸重试上限。
- 有未恢复的 workspace action 失败时，Runtime 不接受 `completed`；活跃 Plan 有未完成或无证据步骤时同样拒绝。
- 回归保证 Resource Service 不受改动，Node 24 全量验证通过。

## 不在本次重构范围

- 不改变 Resource SQLite、Job、Scheduler、Worker 或既有 Resource API。
- 不自动批准 Plan、命令、文件写入或依赖安装。
- 不允许模型自报完成取代 Runtime 证据。
- 不重写通用 Provider、Capability Router 或 UI；仅在生命周期契约必要的接口处接入。

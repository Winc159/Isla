# Isla v0.8.3：Persistent Job 与受限 Subagent

## 设计目标

支持对话之外持续执行的通用 Job，并允许主 Agent 创建一层、受预算和权限约束的子 Agent。Resource Job 保持原系统，不迁移数据库。

## 设计取舍

- **采用**：沿用 `docs/agent-platform-baseline.md` 已记录的 Codex App Server 可恢复任务与 OpenHands 后台任务/会话恢复边界；Job Store 是任务事实源，客户端只通过 Host API 观察和操作。
- **调整**：Job 生命周期归 Resident Host 的 Job Runtime 管理，不能挂在 Session Scope 上；Host 进程退出释放 Worker lease 并将可恢复的 running Job 重新排队，Session 关闭不取消 Job。
- **采用**：Subagent 是 Job 所有的 Agent Scope，最多一层，独立 Session；权限/Workspace/工具/网络/token/时间预算均由父级策略裁剪，子 Agent 无权请求扩权。
- **暂缓**：分布式多 Host 调度、在线 Job 间迁移、任意工作流 DAG、Job 插件市场及 Resource Job 写入通用 Store。
- **拒绝**：把 Resource SQLite/状态机迁入通用 Job、让 Session 继续充当后台任务事实源、以提示词作为权限或终态保证。

此取舍由 v0.8.3 真实需求驱动，若引入多 Host 或 Resource 事实源更换需求则重新评估。

## 实施进度

- [x] 文档命名、路线图索引与基线核对。
- [x] Job schema/store/scheduler/lease。
- [x] Host API、CLI/Web Job View 与订阅。
- [x] Agent Registry parent/child ownership。
- [x] Subagent 生命周期与预算。
- [x] Resource Bridge 统一只读投影。
- [x] 自动验证、真实评估与评分采集。

## 验收记录（2026-10-30）

- Node v24.22.1 全量 `scripts/verify.mjs` 通过：186 个测试文件通过、9 个跳过；783 项测试通过、15 项跳过；离线评估门禁及 Resource/Agent UI 构建通过。
- Resource 服务源码、数据库 schema、Scheduler、状态机和 HTTP API 没有改动。
- 修复前百炼真实评估三轮均为 `70/100`：虽然 Subagent 委托、只读权限、证据、父级复核、写入和回读均通过，但 Runtime 将不同步骤的四次 `update_work_plan_progress` 同名调用误判为无进展；同时 Plan 的 verify 契约只接受 `run_command` 验证，不接受同一路径写后回读。
- 修复后使用百炼 Config/Profile `qwen3.5-397b-a17b` 完成三次独立真实评分，结果 `100/100、100/100、100/100`，全部为 `completed`，每轮七项任务/安全断言均通过。评分记录分别为 `.isla-local/evaluations/subagent-ed2b57aa-a973-4729-a56c-2c27795d77cf/report.json`（1 轮）与 `.isla-local/evaluations/subagent-20cfb309-3ec0-4d2e-84f4-ebf508134b1f/report.json`（2 轮）。一次额外批次在已完成两轮 100 分后，于第三次请求遇到 `PROVIDER_AUTH`，未计分；不影响已取得的三次有效分数。
- 修复前另一次模型轮次因 Host 沙箱下 `run_command` 返回 `spawn EPERM` 被安全停止，未计入有效评分。
- 真实验收门槛已满足；Host 重启后跨进程恢复后台 Job 的部署型人工验收仍单独保留，不与本次 Subagent 评分混为一谈。

## Job 契约

- `jobId`、type、owner、inputRef、status、progress、attempt、waitingUser、artifacts、result、createdAt、updatedAt。
- 状态：queued、running、waiting_user、completed、failed、cancelled。
- Job Store 是通用 Job 的事实源；Session 只记录引用和用户可见结论。
- 幂等创建、租约、心跳、重试、取消、恢复和订阅。

## Subagent 契约

- 父 Agent 显式创建，最多一层。
- 独立 Session/Context/Plan，继承收窄后的 Workspace、Tool、网络、token 和时间预算。
- 子 Agent 无权扩大权限、创建孙 Agent或直接向用户承诺完成。
- 结果以结构化 summary、evidence、artifacts、limitations 返回父 Agent。

## 实施步骤

1. Job schema/store/scheduler/lease。
2. Job App Server API、CLI/Web 视图和通知订阅。
3. Agent Registry parent/child ownership。
4. Subagent create/send/cancel/wait/result。
5. Tool 与 token 并发预算。
6. Resource Bridge Adapter：把 Resource Job 投影为统一只读 Job View，操作仍调用原 API。

## 自动测试

- 幂等、租约过期、重启恢复、重复 Worker、取消竞态和 waiting_user。
- Session 关闭不取消持久 Job。
- Job 完成不自动污染旧 Session。
- 子 Agent 权限只能收窄；深度、预算和并发限制。
- 父 Agent 取消/销毁时的子 Agent 策略。
- Resource mock-e2e 确认零 schema 和状态机改动。

## 真实验收

- 后台研究 Job：CLI 退出、Host 重启、重新连接后继续。
- 主 Agent 委托两个只读子任务并汇总证据，随后自己实施。
- Resource 下载 Job 在统一 UI 展示，但仍由 Resource SQLite 和 Scheduler 执行。

## 完成条件

- 通用 Job 在 Host 重启和客户端断线后可恢复。
- Subagent 深度固定为一层，权限和预算只能收窄。
- Job/Agent 取消、失败和完成都有唯一终态。
- Resource 数据库、Scheduler、状态机和 HTTP API 没有迁移或行为变化。

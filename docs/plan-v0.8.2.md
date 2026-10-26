# Isla v0.8.2：Persistent Job 与受限 Subagent

## 设计目标

支持对话之外持续执行的通用 Job，并允许主 Agent 创建一层、受预算和权限约束的子 Agent。Resource Job 保持原系统，不迁移数据库。

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

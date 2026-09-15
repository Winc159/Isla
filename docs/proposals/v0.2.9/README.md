# Isla v0.2.9 提案入口

候选主题：Runtime Consolidation  
状态：实施中  
日期：2026-09-15

本目录是 v0.2 系列最后一个版本的实施提案。当前 `docs/current/` 仍保留 v0.2.8 作为已发布基线；v0.2.9 完成全部门禁后再迁移。

当前进度：Batch A-G 已完成；Batch H 错误领域分类已完成，版本与最终文档迁移待收口。

- [architecture.md](./architecture.md)：目标、边界、核心契约与 DSH 取舍
- [implementation.md](./implementation.md)：实施批次、停点与收口顺序
- [testing.md](./testing.md)：离线测试矩阵、真实评估与发布门禁

本提案不包含 Local Provider 扩展、Context Budget、Shell、MCP、子 Agent 或后台任务。其目标是完成现有 Unified Agent Stream 的外部闭环，修正能力报告和生命周期语义，并为 v0.3 留下清晰而最小的扩展边界。

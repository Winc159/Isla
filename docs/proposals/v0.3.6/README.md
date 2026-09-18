# Isla v0.3.6 提案入口

状态：B1/B2/C1/C2/D1/D2 已实现；隔离 Bailian/Qwen 两步历史召回真实评估通过。

- [design.md](./design.md)：目标、契约、授权边界、数据投影、模型 Tool 和明确暂缓范围；
- [implementation.md](./implementation.md)：Batch A-E 的执行顺序、涉及文件、停点和接手步骤；
- [testing.md](./testing.md)：协议、授权、搜索、读取、TTY、NDJSON、模型 Tool、安全和回归测试矩阵。

## 下一步

当前停点：v0.3.6 核心实现和真实评估已收口；后续可进行发布前审查，不应在本版继续扩大任务树、后台 Job 或 Skills 范围。

## 接手硬边界

- 不升级 package 版本；
- 不执行 Git add、commit 或 push；
- 不访问真实 Provider；
- 不改变现有 `provider + model + workspaceKey` 自动恢复规则；
- 不提前加入 SQLite、FTS、Embedding、Skills、后台 Job、PTY、任务树、并行 Tool 或子 Agent；
- 所有测试使用虚构数据，不保存私人会话、秘密或完整命令输出。

# Isla v0.3.7.1 提案入口

状态：已实施并收口；离线门禁通过，Bailian NDJSON 真实评估通过；TTY 需真实 PTY 驱动后再补验证。

v0.3.7.1 只补齐一个能力：**用户显式 Skill 调用进入同一模型 Turn**。

当前行为：`/skill <name>` 只输出正文，不触发模型。目标行为：校验并加载 Skill，持久化用户命令与当轮指令上下文，然后进入正常 Agent Loop；Approval、Sandbox、取消和 Tool 上限保持不变。

- [design.md](./design.md)：用户语义、消息持久化、当轮投影、安全和协议契约；
- [implementation.md](./implementation.md)：Batch A-D 的实施顺序和停点；
- [testing.md](./testing.md)：CLI、Session、恢复、取消、Approval、安全和回归矩阵；
- [evaluation.md](./evaluation.md)：离线与隔离真实模型评估方案。

## 最终语义

1. `/skill <name>` 可以只凭 Skill 正文开始一轮；
2. `/skill <name> <request>` 把余下文本作为本轮具体请求；
3. `/skills <name>` 继续只预览正文，不调用模型；
4. Skill 指令只对当前 Turn 生效，但以带来源标记的消息持久化；
5. 恢复时可以重建历史请求，后续 Turn 不重复注入旧 Skill；
6. NDJSON 使用独立的 `skill_invoke` 请求，不允许控制端提交 Skill 正文。

## 硬边界

- 不把 Skill 设为永久 System Prompt；
- 不让 CLI 绕过 Agent Loop、Approval、Sandbox、取消或 read-before-edit；
- 不把正文放进 diagnostics、目录列表或协议响应；
- 不增加 watcher、远程 Skill、脚本执行器、PTY、后台 Job或任务树；
- 不升级 package 版本，不执行 Git 写操作。

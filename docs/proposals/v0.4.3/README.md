# v0.4.3：Context Budget and Compaction

状态：设计完成，等待 v0.4.2

## 目标

让长会话在明确 token/字符预算下持续工作：先裁剪可再获取的大型 Tool Result，再对较老完整回合生成可验证的压缩检查点，同时保持 Tool Call/Result 配对和模型历史可重建。

## 范围

- Provider 路由级上下文预算。
- Tool Result pruning。
- 仅压缩已完成回合的 Compaction Checkpoint。
- `/context` 诊断与 NDJSON 只读状态。
- 恢复后与压缩前语义等价的请求投影。

## 非目标

不做向量记忆、跨 Session 合并、自动删除原始 Session、模型自主修改压缩策略、事件溯源重写或后台 compaction Job。

文档入口：[设计](design.md) · [实施](implementation.md) · [测试](testing.md) · [验收](evaluation.md)

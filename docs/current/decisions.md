# 当前设计取舍

- 控制流只有 `capability_calls` 与 `yield`。
- 首个 Agent Step 看到全部可用 Tool；不使用前置 Decision Gate。
- Tool Result 驱动下一 Step；无 Tool Call 才候选 Yield。
- Completion Gate 只检查证据、配对、Approval、取消和安全等硬不变量，不评价文风或方案质量。
- TaskBrief 是跨 Turn 状态投影，不控制 Tool 可见性。
- Web Search 支持单 query 兼容和有界多 query；Provider 仍按单 query 适配。
- Web Search 通过能力说明引导未知/外部资料优先搜索，不用领域关键词正则强制。
- 保留 Approval、取消、Session 恢复、NDJSON、Web SSRF/DNS/redirect/大小/timeout 安全边界。
- 不引入 DSH 的完整事件总线、Agent Registry、Inbox、Shell、浏览器、MCP、并行 Tool 或子 Agent。

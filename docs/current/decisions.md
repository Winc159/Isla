# Isla v0.2.9 当前设计取舍

- 原生流式优先，但不伪造“假流式”；Provider 没有可用原生流式时走一次性请求。
- OpenAI Responses 原生流式默认开启；DeepSeek Responses Tool streaming 因真实 HTTP 400 默认关闭，显式配置才启用；Local 默认关闭。
- 共享 `ModelStreamAssembler` 统一文本、Tool Call、usage 和终态；不把不完整 Tool 参数交给 Runtime 执行。
- 当前流式结果在 Runtime 内组装为完整响应后继续既有 Tool Loop；不新增逐字输出，也不把模型增量写入 Session/Journal。

- 控制流只有 `capability_calls` 与 `yield`。
- 首个 Agent Step 看到全部可用 Tool；不使用前置 Decision Gate。
- Tool Result 驱动下一 Step；无 Tool Call 才候选 Yield。
- Completion Gate 只检查证据、配对、Approval、取消和安全等硬不变量，不评价文风或方案质量。
- TaskBrief 是跨 Turn 状态投影，不控制 Tool 可见性。
- Web Search 支持单 query 兼容和有界多 query；Provider 仍按单 query 适配。
- Web Search 通过能力说明引导未知/外部资料优先搜索，不用领域关键词正则强制。
- 保留 Approval、取消、Session 恢复、NDJSON、Web SSRF/DNS/redirect/大小/timeout 安全边界。
- 不引入 DSH 的完整事件总线、Agent Registry、Inbox、Shell、浏览器、MCP、并行 Tool 或子 Agent。

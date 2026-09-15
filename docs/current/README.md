# Isla v0.2.9 当前文档入口

当前可执行基线为 v0.2.9（Runtime Consolidation）只以本目录为准：

- [architecture.md](./architecture.md)：当前架构与硬不变量
- [implementation.md](./implementation.md)：当前实施顺序与未完成批次
- [testing.md](./testing.md)：当前测试计划与门禁
- [evaluation.md](./evaluation.md)：最新真实评估结论
- [decisions.md](./decisions.md)：已确认取舍与暂不实施事项

历史版本、被取代方案和旧交接材料见 [../archive/index.md](../archive/index.md)。真实评估日志见 [../evaluations/](../evaluations/)。

v0.2.9 已完成 Runtime Consolidation：模型 Step、请求上下文、能力报告、错误领域和真实模型增量观察统一进入 Runtime/Protocol/CLI；OpenAI 原生流式默认开启，DeepSeek Tool Loop 默认仍走已验证的一次性路径。

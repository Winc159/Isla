# v0.4.6：Model Limits and Token-aware Context Guardrails

状态：设计完成，等待实施

## 目标

把 Provider 模型目录中的上下文、输入和输出限制转化为 Isla 可执行、可解释的请求预算。在保留 v0.4.3 完整 Session 事实与 checkpoint 压缩语义的前提下，避免长会话、小模型和本地模型因输入膨胀、输出失控而显著降速或直接触发 Provider 上下文错误。

## 范围

- 统一模型限制元数据：上下文窗口、最大输入、最大输出和可选推理限制。
- Profile 可声明工作预算，模型硬限制与用户预算取更严格值。
- 使用保守 Token 估算覆盖消息、Tool schema 和请求时注入内容。
- 在请求前预留输出空间、提前压缩，并拒绝无法安全容纳的单次输入。
- 将有效预算、来源、当前占用和压缩原因暴露给 `/models info`、`/context` 与诊断。
- 将输出上限通过统一请求契约传给支持的 Provider。

## 非目标

不引入各模型专属 tokenizer、自动模型路由、根据模型目录静默修改 Profile、后台压缩任务、不可逆删除历史、推理内容持久化或按成本自动选模。v0.4.6 不解决模型本身的 Function Calling、结构化输出或推理质量问题。

文档入口：[设计](design.md) · [实施](implementation.md) · [测试](testing.md) · [验收](evaluation.md)

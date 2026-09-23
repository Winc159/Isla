# v0.4.6 实施步骤

每个 Batch 独立完成 typecheck、相关测试和 diff 审查；前一 Batch 通过后再进入下一 Batch。不得顺带调整模型能力声明或采样参数。

## Batch A：限制元数据与配置契约

1. 将通用模型目录条目扩展为统一 `ModelLimits`，补齐百炼已有字段及可选推理限制投影。
2. 保持旧缓存可读，验证新缓存只含非敏感模型元数据。
3. 为 `profile.runtime` 增加 `maxContextTokens`、`maxOutputTokens`、`contextReserveTokens` 的解析、默认值和错误信息。
4. 建立限制来源和优先级测试，不在普通启动时刷新模型目录。

停点：可以从 live/cache/Profile 得到确定的限制快照；旧 Profile、旧 cache 和无目录 Provider 均可正常启动。

## Batch B：Token 估算与预算解析

1. 实现纯函数 `conservative-v1` 估算器，覆盖 Message、Tool Call、Tool result 和 Tool schema。
2. 实现 `ContextBudgetPolicy` 解析，统一计算输入、输出和安全预留。
3. 扩展现有 Context Budget Report，同时保留字符、轮次字段。
4. 对矛盾限制、未知值和 stale 来源增加非敏感诊断。

停点：相同请求在所有入口得到相同估算和预算；估算不读取 Session 之外的隐藏全局状态。

## Batch C：请求投影与压缩门禁

1. 在 `RequestContextBuilder` 完成真实请求装配后执行 Token 预算检查。
2. 复用 v0.4.3 完整 Conversation Unit 和 checkpoint 机制缩减旧上下文。
3. 当前轮单独超限时返回 `CONTEXT_INPUT_TOO_LARGE`，确保 Provider 未被调用。
4. 压缩失败回退仍执行硬预算检查；Tool Call 与 Tool result 不得拆分。
5. Journal 只记录估算值、预算、来源、压缩/拒绝原因，不记录正文。

停点：长会话在 Provider 调用前完成压缩；不可安全容纳的请求确定性失败，完整 Session 事实不丢失。

## Batch D：输出封顶与 Provider 映射

1. 为 `ModelRequest` 增加 `maxCompletionTokens`。
2. 在百炼及已验证 Provider 中映射正确协议字段。
3. 对不支持该字段的 Provider 保持明确能力与诊断，不猜测协议。
4. 将 Provider 上下文超限错误归一化为 limit domain，并禁止相同请求重试。

停点：自动化测试能观察到正确输出参数；limit 错误不会被误判成可重试网络错误。

## Batch E：命令、Surface 与真实评估

1. 增加 `/models info <model-id>`，优先读当前身份对应缓存，显式 refresh 才联网。
2. 扩展 `/context` 和等价 NDJSON/Host 状态，展示估算、有效预算、来源和压缩状态。
3. 使用百炼 7B 完成长会话、长单轮、输出封顶和目录缺失四组真实测试。
4. 在可用的 macOS ARM64 本地模型服务上复用同一测试；若当前无设备，记录为发布环境补证，不伪造结果。
5. 运行完整 `npm run verify`、tarball smoke 和隐私扫描，填写 `evaluation.md`。

停点：用户能够解释“模型标称多少、Isla 实际使用多少、为什么发生压缩或拒绝”；完整回归无新增失败。

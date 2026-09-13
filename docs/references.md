# Isla 参考资料

只记录直接影响当前设计的官方资料。外部项目用于理解问题与权衡，不作为复制源码的授权。

## Runtime 与工具链

- [Node.js Releases](https://nodejs.org/en/about/previous-releases) — LTS 状态与生产版本选择。
- [Node.js ESM](https://nodejs.org/api/esm.html) — ES Modules 行为。
- [npm package.json](https://docs.npmjs.com/files/package.json/) — `bin`、`files`、`engines` 等包字段。
- [Vitest Getting Started](https://vitest.dev/guide/) — 测试运行器与 Node 版本要求。
- [MSW Node Integration](https://mswjs.io/docs/integrations/node/) — Node 中拦截外部 HTTP 请求。

## Model Provider

- [OpenAI Responses API](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create) — OpenAI 文本响应接口。
- [OpenAI Node Responses Guide](https://github.com/openai/openai-node/blob/main/docs/responses.md) — `output_text` 与会话延续方式。
- [OpenAI Node Client Configuration](https://github.com/openai/openai-node/blob/main/docs/configuration.md) — timeout、retry 与 request ID。
- [DeepSeek API](https://api-docs.deepseek.com/) — OpenAI-compatible Chat Completions 与 Base URL。
- [Ollama OpenAI Compatibility](https://docs.ollama.com/api/openai-compatibility) — 本地兼容接口。
- [LM Studio OpenAI Compatibility](https://lmstudio.ai/docs/developer/openai-compat) — 本地 Responses 与 Chat Completions。
- [MLX-LM Server](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/SERVER.md) — Apple Silicon 本地 HTTP 服务。

## Agent Runtime 参考实现

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — 用于审查插件边界、Provider 适配、会话日志和模型历史不变量；不作为 Isla 的依赖或脚手架。
- [本次审查的 DSH 提交](https://github.com/deepseek-ai/deepseek-harness/commit/76fda729799fe9b3848dbe2c211d4b231032b81e) — `0.1.2-rc.1`，查看日期 2026-09-08；具体采用、暂缓和拒绝项见 [DSH 参考评审](dsh-reference-review.md)。
- [DSH Session](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session.md) — 事实日志与模型消息投影，影响 v0.2.1 的“原始事实与上下文视图分离”；查看日期 2026-09-11。
- [DSH Compaction](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/compaction.md) — 持久化压缩检查点、Tool 配对边界和失败语义；采用原则，拒绝完整事件框架；查看日期 2026-09-11。
- [DSH Session Query](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/session-query.md) — 确定性读取、过滤和全文检索；v0.2.1 采用职责分离，暂缓完整 Query 服务；查看日期 2026-09-11。
- DSH Session Query 对 v0.2.3 的补充取舍：采用确定性读取、可定位来源和可重建派生视图；暂缓 SQLite/FTS、查询 DSL 和跨项目统一索引；查看日期 2026-09-12，具体见 `docs/architecture-v0.2.3.md`。
- [DSH Tools](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/tools.md) — 模型可见 schema、host-only Tool 定义字段、规范化执行结果和最终权威结果的边界；v0.2.4 采用“展示内容与 Runtime details 分离”，不复制 middleware 或类型框架；查看日期 2026-09-12。
- [DSH Session Query package](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session-query/session-query/README.md) — 确定性读取、语义文档投影、live-preferred corpus 与全文索引职责边界；v0.2.4 采用稳定身份、排序和关系校验原则，继续暂缓 SQLite backend、游标与 reconciliation；查看日期 2026-09-12。
- [DSH Compaction packages](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/compaction/README.md) — 先裁剪过大 Tool Result 再压缩历史的职责拆分；v0.2.4 只采用有界 Tool 输出与优先保留有效片段，不引入 pruner pipeline 或 spill store；查看日期 2026-09-12。
- [DSH DeepSeek Provider](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-deepseek/src/index.ts) — Provider/model 配置与凭据解析分离；v0.2.5 采用“启动路由不进入模型历史、缺少凭据明确失败”的原则，但按用户选择使用单个本地 `config.json`，不复制其配置或 credential service；查看日期 2026-09-12。
- DSH host composition、资源所有权与 capability negotiation 对 v0.2.5.1 的补充取舍：采用单一装配和入口等价不变量；拒绝 Cordis、通用服务容器、Surface 和完整事件框架；具体见 `docs/architecture-v0.2.5.1.md` 与 `docs/dsh-reference-review.md`，查看日期 2026-09-13。
- [DSH Agent cancellation](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/core.md) — 当前活动独占signal、空闲cancel不影响未来工作、第一原因生效以及等待quiescence；v0.2.6采用这些不变量，拒绝Inbox、steer、Agent Registry和事件溯源Session；查看日期2026-09-13。
- [DSH Tool cancellation](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/README.md) — Tool执行接收活动signal并协作停止；v0.2.6映射到Isla现有ToolRuntime/Tool接口，不复制DSH middleware、scope或包结构；查看日期2026-09-13。
- [OpenHands Condenser](https://docs.openhands.dev/sdk/arch/condenser) — 压力触发、保留尾部和 View 投影；采用最小语义，不引入通用 Pipeline；查看日期 2026-09-11。
- [LangGraph Memory](https://langchain-ai.github.io/langgraph/how-tos/memory/manage-conversation-history/) — Thread 持久化、裁剪和滚动摘要；采用派生摘要，拒绝 Graph 编排和删除原文；查看日期 2026-09-11。
- [Letta Memory Architecture](https://github.com/letta-ai/skills/blob/main/letta/letta-api-client/memory-architecture.md) — Core Memory、消息窗口、归档和语义检索分层；直接影响 v0.2.1 的四层记忆模型；查看日期 2026-09-11。

## SQLite 与 Embedding

- [Node.js 24 SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html) — 内置 SQLite、foreign keys、busy timeout、defensive mode 和扩展加载边界；采用，查看日期 2026-09-11。
- [OpenAI Embeddings](https://developers.openai.com/api/reference/ruby/resources/embeddings/methods/create) — 批量 Embedding 请求与 dimensions；用于独立 Embedding Provider，查看日期 2026-09-11。
- [Ollama Embeddings](https://docs.ollama.com/capabilities/embeddings) — 本地 Embedding、批量输入和归一化向量；用于 Local Provider 设计参考，查看日期 2026-09-11。
- [sqlite-vec](https://github.com/asg017/sqlite-vec) — SQLite 向量扩展；当前 pre-v1 且 Node 跨平台打包仍有风险，v0.2.1 暂缓依赖，达到规模阈值后重新评估；查看日期 2026-09-11。

## 部署

- [npm 全局安装](https://docs.npmjs.com/downloading-and-installing-packages-globally/) — CLI 包安装方式。
- [Docker Desktop Networking](https://docs.docker.com/desktop/features/networking/networking-how-tos/) — 容器访问宿主机服务。
- [Node.js Single Executable Applications](https://nodejs.org/api/single-executable-applications.html) — 稳定后可研究的无 Node 分发方式。

## 阅读记录规则

以后向本文件添加资料时，必须同时记录：

1. 它解决什么问题。
2. 哪一项 Isla 设计受到影响。
3. 是采用、拒绝还是暂缓。
4. 查看日期，避免把旧接口当成当前事实。

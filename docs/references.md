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

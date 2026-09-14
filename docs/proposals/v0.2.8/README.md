# Isla v0.2.8 提案入口

状态：方案已确认，待实现收口  
主题：Unified Agent Stream

本目录不是当前可执行基线。当前唯一执行基线仍是 `docs/current/`。

- [architecture.md](./architecture.md)：统一 Provider 流、Step 组装和提交边界
- [implementation.md](./implementation.md)：按批次实施与停点
- [testing.md](./testing.md)：离线、协议和真实 Provider 测试矩阵

本提案的核心约束：只消费 Provider 原生流，不把完整回答切片伪装成流式输出；不支持或未通过兼容性验收的 Provider 继续走现有 one-shot 路径。当前决策为 OpenAI 默认原生 streaming，DeepSeek 默认 one-shot Tool Loop，Local 默认 one-shot。

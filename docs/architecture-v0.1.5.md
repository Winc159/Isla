# Isla v0.1.5 Prompt 分层与项目文件能力

## 目标

验证“分层 Prompt + 静态 Capability + Tool Agent Loop”的最小闭环，使 Isla 能读取当前项目内的文本文件并基于真实内容回答。

## 采用

- Prompt 分为极简人格、Runtime 行为约束、能力说明、会话历史和当前用户请求。
- 请求加载 Capability 时才注入对应能力说明；未加载能力的 Session 保持原 Provider 请求行为。
- `project-files` Capability 静态组合 `list_directory` 与 `read_text_file`。
- Tool 统一暴露 definition 与 execute，不让 ChatSession 依赖具体工具实现。
- ChatSession 最多执行三轮 Tool Loop；Tool 中间消息不写入持久会话，最终有效回答才保存为 assistant。
- 文件能力仅访问启动时的项目根目录，拒绝绝对路径、目录穿越和 `.env` 等明显秘密文件。
- DeepSeek 使用原生 Tool Calls；同时兼容当前模型可能返回的文本 DSML 调用格式。
- 交互式 CLI 显示正在使用的工具；非 TTY 不输出动态状态。

## 暂缓

- 动态 Tool 扫描、安装、卸载和插件市场。
- 通用依赖注入容器与 Tool Registry。
- 额外 LLM 路由请求和自动能力发现。
- Tool 权限确认、写文件、Shell 和网络访问。
- OpenAI 与 Local Provider 的 Tool API 适配。
- Tool 调用过程的持久化与跨版本重放。

## 重新评估条件

- Capability 数量增长并造成请求上下文明显膨胀时，引入独立能力路由。
- 出现第二类真实 Tool 权限需求时，设计统一授权边界。
- 需要完整重放模型请求时，为会话记录 Capability ID 与 Prompt 版本。

# Isla 后续方向

本文件只记录方向，不承诺时间，不授权提前实现。每一阶段必须由真实使用问题触发，并保持前一阶段可运行。

## v0：最小连续对话

- 插件化 Runtime。
- OpenAI、DeepSeek、Local Provider。
- 进程内完整会话上下文。
- CLI、离线测试、构建与 npm 打包。

完成信号：三种 Provider 契约一致，至少两个云 Provider 可真实对话，全部自动测试通过。

## v0.1.4：流式输出

- Provider 原生流式响应统一为 `generateStream()`。
- OpenAI、DeepSeek、Local Provider 在适配层转换为文本增量。
- CLI 边接收边输出；流完成后才保存完整 assistant 消息。
- 流式失败或中断时保留 user 消息，不保存不完整 assistant 消息。
- 保留一次性 `generate()`，不让 CLI 事件格式进入 Runtime 消息协议。

## 候选阶段：会话持久化

触发条件：退出 CLI 后确实需要继续同一会话。

研究问题：会话身份、存储格式、迁移、隐私和删除。先使用可读本地文件，再根据规模决定是否需要数据库。

## 候选阶段：Context 管理

触发条件：完整历史超过模型上下文或成本不可接受。

研究方向：最近窗口、摘要、重要信息保留、重新搜索、遗忘。必须保存实验数据，比较正确率、成本与信息损失。

## v0.1.6：Tool Runtime、Approval 与最小文件沙盒

完成内容：

- PromptRegistry 与 ToolRegistry；
- ToolRuntime 统一查找、执行和失败结果；
- `readonly` / `workspace` 权限预设；
- CLI raw 单键审批：本次批准、拒绝、当前进程内持续批准；
- 文件级 SandboxPolicy：项目根目录、目录穿越、符号链接和敏感文件边界；
- `list_directory`、`read_text_file`、`write_text_file`；
- 写入意图强制路由和 Provider `tool_choice`；
- Tool Loop 上限 8 轮。

完成信号：读写文件、审批拒绝、沙盒越界、符号链接逃逸和工具失败均有自动测试。

仍未完成：Session Event 持久化、OpenAI/Local Tool API、Shell、网络和容器级沙盒。

## 候选阶段：Tool 插件

触发条件：Isla 需要执行第一个真实外部动作。

继续以真实能力为驱动扩展 Tool；先完成 Session Event 审计与重放，再考虑 Shell 或网络能力。不要先建设通用 MCP 平台。

## 候选阶段：文档与知识检索

触发条件：Markdown 文档数量已无法靠普通搜索维护。

先使用文件与全文搜索；只有检索质量不足时再引入索引、Embedding 或向量数据库。

## 候选阶段：个人长期记忆

触发条件：明确区分“聊天历史”“知识”和“个人经验”之后。

记忆应优先保存个人偏好、过去行动、项目状态与经验，不把可以重新搜索的通用知识无差别永久保存。

## 候选阶段：常驻服务与入口

触发条件：CLI 不足以支持全天在线。

可能包括 Linux systemd、macOS LaunchAgent、HTTP/IM/语音入口。Runtime 保持与入口无关。

## 候选阶段：自动演化

触发条件：已有稳定测试、评测集、回滚机制和人工审查流程。

研究 Stable、Candidate、Reviewer、Challenge 与 Human Promotion。在此之前禁止让 Isla 自动修改并部署自身。

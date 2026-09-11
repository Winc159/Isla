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

## v0.1.8：分阶段对话与 Agent Loop

计划内容：

- 每轮普通用户输入先由 `IntentClassifier` 结构化分类；
- 区分回答、检查、讨论、执行和未知意图；
- 讨论转执行前保留明确的用户确认状态；
- `ContextResolver` 根据轮次摘要按需选择历史；
- `PromptRegistry` 按 intent、context、discussion、tool-loop、completion、final 和 summary 阶段装配；
- Agent Loop 显式返回 continue、completed、needs_user 或 blocked；
- 完成状态同时经过模型判断和 Runtime 硬性条件；
- Tool 失败按是否可恢复分类，禁止绕过 Approval、权限和 Sandbox；
- 必要时从成功 Tool 结果生成简短来源列表；
- 补齐 Session Event 和模型请求重建测试。

实施依据：`docs/architecture-v0.1.8.md` 与 `docs/luna-implementation-v0.1.8.md`。

完成信号：检查任务不会因一次无 Tool Call 提前结束，讨论意图不会直接写入，执行任务只有在确认、审批和可验证 Tool 结果均满足后才标记完成；阶段 Prompt、历史选择、失败恢复和旧会话兼容均有自动测试。

当前实现仍需修正后才能视为完成：确认后必须恢复原任务，`unknown` 必须零 Tool Call，重复失败必须真正进入 blocked，摘要必须包含结构化目标、结果和证据并可跨进程恢复。具体修复顺序以 `docs/luna-implementation-v0.1.8.md` 的“当前实现审计”和“实施批次与停点”为准。

暂不包括：SQLite Session Query、长期记忆、Shell、网络、删除、并行 Tool、子 Agent 和完整思维链。

## v0.1.9：本地 NDJSON 测试协议

计划内容：

- 增加 `--protocol ndjson` 本地机器可读入口；
- 外部测试进程可连续发送 prompt 并读取流式响应；
- Tool、Approval、错误、会话切换和退出使用结构化事件；
- stdout 只输出 NDJSON，诊断只输出 stderr；
- 保持 Permission、Approval 和 Sandbox 边界；
- 使用 FakeProvider 完成离线协议与子进程回归；
- 真实 Provider smoke test 只显式运行。

实施依据：`docs/architecture-v0.1.9.md` 与 `docs/luna-implementation-v0.1.9.md`。

进入 v0.2.0 前的最终收口以 `docs/luna-closeout-v0.1.9.md` 为唯一准入清单。该清单按当前源码重新审计了 v0.1.8/v0.1.9 遗留缺陷，并要求 Tool、Approval、Session、持久化、子进程协议和两轮真实 Provider 日志全部达到逐场景门槛；旧实施文档只保留为设计和历史执行顺序参考。

完成信号：外部控制方可以稳定启动 Isla、完成多轮对话、处理审批、观察 Tool 生命周期并正常退出，且现有交互式 CLI 无回归。

协议稳定并完成至少两轮真实回归后，再评估把测试编排沉淀为 `isla-runtime-testing` Skill；v0.1.9 不把 Runtime 协议实现放进 Skill。

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

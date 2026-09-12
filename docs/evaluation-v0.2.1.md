# Isla v0.2.1 验证记录

日期：2026-09-12

## 离线门禁

- typecheck：通过；
- 自动测试：32 个测试文件，其中 29 个通过、3 个真实测试文件默认跳过；118 条通过、3 条跳过；
- build：通过；
- pack dry-run：通过，包内无数据库、会话、索引或测试数据；
- git diff check：通过，仅有工作区既有的 CRLF 提示；
- 协议测试连续两次：每次 2 个文件、11 条测试全部通过。

## 真实 NDJSON 验收

使用本地 `.env` 中已配置的 DeepSeek Provider 执行 `tests/smoke/real-ndjson.test.ts`。扩展后的测试连续完成两轮，总耗时约 20.3 秒。

每轮覆盖：普通问答、明确记忆、目录检查、只读讨论、写入审批拒绝、`new_session`、跨会话询问记忆、写入审批批准、临时文件实际落盘、`exit` 和 `bye`。进程退出后重新打开临时 Memory SQLite，断言 active 记录、内容和 Session Source。stdout 由测试驱动逐行解析为 JSON；Approval 数量和 ID、Session 切换、文件内容及退出事件均通过断言。测试 workspace、session 和 memory 目录在 `finally` 中清理。

测试未记录真实对话正文、API Key、完整 Tool Result、Embedding 或私人记忆内容。

## 收口判断

v0.2.0 的 CLI、Tool、Approval、Session 和 NDJSON 主链路真实回归通过。v0.2.1 的 Session v2、Working Memory、SQLite Memory、Policy、关键词、Embedding、混合召回、明确记忆和压缩后 Candidate 提取均已接入实现，并通过离线测试。

当前代码已经完成 Embedding 的配置读取和生产装配：OpenAI 与 Local Embedding Provider 可独立于聊天 Provider 配置；Embedding 成功时建立 generation 并参与混合召回，失败时保留文本索引并降级到关键词检索。会话压缩后的结构化 checkpoint 也会提取安全的推断内容为 Candidate，Candidate 默认不进入 Core Memory。

收口结论：离线收口门禁已通过，v0.2.1 的实现完成。既有真实 DeepSeek NDJSON 记录已通过两轮完整链路验收；本次复核未重复发送真实 API 请求，因为这需要用户明确授权并可能产生费用。真实 Embedding endpoint 仍应在配置实际服务后单独执行一次验收，但不再是当前代码缺口。

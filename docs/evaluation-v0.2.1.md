# Isla v0.2.1 验证记录

日期：2026-09-11

## 离线门禁

- typecheck：通过；
- 自动测试：24 个文件通过、3 个真实测试文件默认跳过；103 条通过、3 条跳过；
- build：通过；
- pack dry-run：通过，包内无数据库、会话、索引或测试数据；
- git diff check：通过，仅有工作区既有的 CRLF 提示；
- 协议测试连续两次：每次 2 个文件、11 条测试全部通过。

## 真实 NDJSON 验收

使用本地 `.env` 中已配置的 DeepSeek Provider 执行 `tests/smoke/real-ndjson.test.ts`。扩展后的测试连续完成两轮，总耗时约 20.3 秒。

每轮覆盖：普通问答、明确记忆、目录检查、只读讨论、写入审批拒绝、`new_session`、跨会话询问记忆、写入审批批准、临时文件实际落盘、`exit` 和 `bye`。进程退出后重新打开临时 Memory SQLite，断言 active 记录、内容和 Session Source。stdout 由测试驱动逐行解析为 JSON；Approval 数量和 ID、Session 切换、文件内容及退出事件均通过断言。测试 workspace、session 和 memory 目录在 `finally` 中清理。

测试未记录真实对话正文、API Key、完整 Tool Result、Embedding 或私人记忆内容。

## 收口判断

v0.2.0 的 CLI、Tool、Approval、Session 和 NDJSON 主链路真实回归通过。v0.2.1 的 Session v2、Working Memory、SQLite Memory、Policy、关键词、Embedding、混合召回和明确记忆模块通过离线测试；跨会话明确记忆已通过真实 NDJSON 验收。

当前仍不能宣布完整 v0.2.1 完成：Embedding Provider 尚未进入生产请求的可配置装配，当前生产召回路径使用关键词检索；自主记忆目前只实现明确“记住”表达，尚未实现压缩后模型提取和 Candidate 审核自动化。版本号已经预置为 0.2.1，发布前必须补齐 Embedding 配置/生产混合召回与提取策略验收。

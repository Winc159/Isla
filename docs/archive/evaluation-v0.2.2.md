# Isla v0.2.2 验证记录

日期：2026-09-12

## 实现范围

- Session v3 与 v1/v2 兼容升级；
- Turn/Attempt Journal 与安全错误记录；
- Provider 错误分类与有限重试；
- ModelRequest 快照与 SHA-256 校验；
- Tool/Checkpoint 安全 action 关联；
- `/trace` 只读诊断入口；
- CLI/NDJSON 失败终态收口；
- 离线记忆召回评测集。

## 离线门禁

本轮执行：

```text
npm run typecheck
npm test
npm run build
npm run pack:check
git diff --check
```

Batch A-I 定向测试均已通过。最终全量结果：37 个测试文件通过、3 个真实测试文件跳过；138 条测试通过、3 条跳过。`npm run typecheck`、`npm run build`、`npm run pack:check` 和 `git diff --check` 均通过。npm dry-run 包含 dist、README 和 LICENSE，不包含 tests、sessions、memory、日志或 `.env`。

## 安全边界

Journal 不参与模型历史投影；`/trace` 不输出对话正文、记忆正文、Tool 参数或 Tool Result。真实 API、`.env`、会话文件和日志不进入测试 fixture、npm 包或 Git 操作。

## 未执行项

- 真实 DeepSeek NDJSON 已在用户授权后执行并通过；修复后两轮完整场景耗时约 20.5 秒。普通回答、明确记忆、目录检查、讨论、Approval 拒绝/批准、`new_session`、跨会话召回、文件落盘和退出均通过。
- 未执行 Git add/commit/push；
- v0.2.2 真实 Provider 连续两轮验收已完成。

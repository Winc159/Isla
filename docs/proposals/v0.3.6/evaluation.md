# Isla v0.3.6 评估记录

状态：核心实现和隔离真实评估通过，待发布前收口。

## 已验证

- 离线 Session Query：workspace 隔离、跨 Provider/模型搜索、状态摘要、秘密脱敏、Tool 消息排除和有界读取通过；
- NDJSON `sessions_search`：在隔离 Bailian workspace 中返回预置旧 Session；
- Qwen 真实调用：模型曾实际调用 `search_session_history`，并产生正常 `response_end`；
- 真实评估使用隔离 Config/Profile、临时 workspace 和临时 Session directory，未保存 API Key、搜索正文或模型回答正文。

## 根因修复记录

首次严格评估未产生终态。根因是模型 Tool schema 使用了 camelCase（`sessionId`、`anchorMessageIndex`），而 Qwen 在第二步生成了 snake_case 参数，未知字段校验使 Tool 反复失败。

已将模型边界修正为：

```text
session_id
anchor_message_index
```

Runtime 内部仍使用 `sessionId` 和 `anchorMessageIndex`。

修正后，隔离 workspace 同时存在一个当前 Session 和一个可命中的旧 Session，Qwen 稳定完成：

```text
search_session_history → read_session_context → final answer
```

真实评估在 90 秒门限内完成，观察到 `search_session_history`、`read_session_context` 和唯一 `response_end`。不保存搜索词、历史正文或模型回答正文。

## 门禁

- `npm test`：85 个测试文件通过、5 个真实 smoke 跳过；378 passed、7 skipped；
- 针对性协议/Session/Query/Tool 回归：54/54 通过；
- `npm run typecheck`：通过；
- `npm run build`：通过；
- `git diff --check`：通过；
- `npm audit --omit=dev`：0 vulnerabilities；
- `npm run pack:check`：本机 npm cache 临时目录遇到 EPERM，发布前需要重跑。

## 清理

真实 smoke 的 Config、Session、workspace 和 memory 临时目录由测试 finally 清理。评估输出不应写入仓库或长期日志。

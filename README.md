# Isla

Isla 是一个使用 TypeScript 开发的个人 Agent Runtime。目前通过 CLI 提供进程内连续对话，支持 OpenAI、DeepSeek 和兼容 OpenAI 接口的本地模型服务。

## 使用

将 `.env.example` 复制为 `.env`，设置 `ISLA_PROVIDER`、`ISLA_MODEL`，以及对应的 API Key 或 `ISLA_BASE_URL`，然后运行：

```bash
npm run dev
```

构建后也可以运行：

```bash
npm run build
npm start
```

输入 `/new` 开启新对话，输入 `/sessions` 通过方向键选择历史会话，输入 `/memory` 查看长期记忆，输入 `/trace` 查看安全运行摘要，输入 `/exit` 或按 `Ctrl+C` 退出。

等待模型返回时，交互式终端会显示生成状态和本次请求耗时。DeepSeek 默认使用非思考模式，以降低普通对话的等待时间。

## 会话保存

对话以 JSON 文件保存在 `~/.isla/sessions/`。Isla 启动时会恢复当前 Provider 和模型对应的最近会话。

如果默认 home 目录不可写，可以设置 `ISLA_SESSION_DIR` 指向可写的会话目录；交互式 CLI 和 NDJSON 测试入口共用该配置。

`/sessions` 会列出当前 Provider 和模型对应的历史会话。使用上下方向键或 PageUp/PageDown 移动，按 Enter 切换，按 Esc 取消。切换后会清屏并回放所选会话的历史消息。

会话文件保留完整历史，但每次请求默认最多向模型发送最近 20 个完整对话轮次，并使用 60000 字符预算；Tool Call 与 Tool Result 不会被拆开。达到压力后，较早轮次会压缩为可恢复的 Working Memory 检查点，默认保留最近 6 轮原文。可以通过 `ISLA_MAX_CONTEXT_TURNS`、`ISLA_MAX_CONTEXT_CHARS` 和 `ISLA_CONTEXT_RETAIN_TURNS` 调整边界。

会话文件包含完整对话内容，属于用户私人数据，不应提交到 Git 仓库或公开分享。v0.2.2 起新保存会话使用 Session v3，并额外保存不含正文的 Turn Journal；旧 v1/v2 文件会在下一次成功保存时升级。

## 分层记忆

v0.2.1 提供 Working Memory 检查点、SQLite 长期记忆、Core Memory Block、关键词检索以及可选 Embedding 基础层。长期记忆默认保存在 `~/.isla/memory.sqlite`，包含来源和可恢复的修订历史；Candidate、停用记忆和其他工作区的私有记忆不会进入默认召回。

`/memory` 当前支持 `list [status]`、`show <id>` 和 `disable <id>`。Embedding Provider 与聊天 Provider 独立；没有配置或调用失败时退回关键词检索。SQLite、会话、索引和向量均属于私人数据，不进入 npm 包或日志。

## NDJSON 协议

协议模式使用 stdin/stdout，不启动 HTTP、WebSocket 或 TCP 服务：

```bash
npm run dev -- --protocol ndjson
```

stdin 每行发送一个 JSON 请求，例如 `prompt`、`approval_response`、`new_session` 或 `exit`。stdout 每行都是 JSON 事件，常见事件包括 `ready`、`response_start`、`response_end`、`tool_start`、`tool_end`、`approval_request`、`session_changed`、`error` 和 `bye`。当前版本不输出文本增量事件。诊断信息只写入 stderr；不要把 API Key、`.env` 或私人会话内容写入日志。


协议同一时间只处理一个 prompt。处理期间发送另一个 prompt 会收到可恢复的 `BUSY` 错误。写入类 Tool 需要先收到匹配 `approvalId` 的批准。Provider 失败只输出 `error`，不会追加空的 `response_end`。

## 测试与真实 smoke

默认测试不访问网络：

```bash
npm test
npm run typecheck
npm run build
npm run pack:check
git diff --check
```

真实 DeepSeek smoke 必须显式开启，并使用当前 shell 已配置的环境变量：

```powershell
$env:ISLA_RUN_REAL_SMOKE = "1"
npm run test:smoke:real
```

该命令要求 `DEEPSEEK_API_KEY` 和 `ISLA_MODEL`。未满足条件时测试保持跳过，避免默认测试产生网络请求或费用。

完整真实 NDJSON 场景（两轮问答、inspect、只读 discuss、Approval 拒绝/批准、new_session 和退出）使用：

```powershell
$env:ISLA_RUN_REAL_SMOKE = "1"
npm run test:smoke:real:ndjson
```

如果 Codex 或后台运行时无法直接看到终端输出，可以把完整协议交互保存到文件：

```powershell
$env:ISLA_RUN_REAL_SMOKE = "1"
$env:ISLA_NDJSON_LOG = "./data/ndjson-real.log"
npm run test:smoke:real:ndjson
```

日志包含发送给 Isla 的请求、协议事件和最终回答。该文件可能包含私人会话内容，默认不会生成，也不应提交到 Git。

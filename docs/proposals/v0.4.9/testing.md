# v0.4.9 验收记录

本文件记录文档收口的验证方法。最终命令结果在实际执行后填写，不把未运行项目写成通过。

## 静态检查

- [x] 所有 Markdown 相对链接可解析；
- [x] 文档引用的源码路径存在；
- [x] 文档引用的 npm scripts 存在；
- [x] README、package、lockfile 与 v0.4.9 文档版本一致；
- [x] 不引用已移除的版本专项脚本；
- [x] Markdown 链接不使用本机绝对路径；
- [x] `docs/` 不含原始云端 JSON/NDJSON 日志；
- [x] 未发现真实 API Key、Token、密码或凭据；
- [x] `git diff --check` 通过。

## Runtime 回归

- [x] `npm run verify`：类型检查、完整离线测试和构建；116 个测试文件通过、7 个跳过，476 项测试通过、11 项跳过。
- [x] `npm run pack:check`：发布内容来自 package 白名单。首次因用户级 npm cache 权限失败，改用 `.isla-local/npm-cache` 后通过。

源码路径检查以 `docs/current/` 和根 README 的当前事实为门禁。Archive 与历史 proposal 中仍有当时计划但最终未采用的路径（例如拆分式 session-query/skills 文件），它们保留为历史设计记录，不代表当前文件应存在。

## 真实环境

本次已在隔离临时 workspace/session 中使用百炼 Profile 执行 `qwen-plus-2025-07-28` 真实对话评估。启动、Tool Calling、只读读取、Approval 拒绝、Approval 批准、编辑后继续 Model Step 和终态完整性共 10 项 Runtime/Tool 门禁通过。原始记录位于 `.isla-local/evaluations/`，未进入 Git。

尚未执行的真实环境项目：第三方 MCP、目标机 PTY、Linux systemd、macOS launchd、跨平台 Browser 和其他 Provider。它们依赖各自网络、凭据或目标主机，应继续标记为未执行。

## 最终结果

文档与离线 Runtime 门禁通过；百炼真实评估的 Runtime/Tool 门禁通过。Windows 测试期间 `node-pty` 的 helper 子进程打印 `AttachConsole failed`，但 Vitest 汇总、类型检查与构建均成功。多轮上下文复述不准确、代码生成误触发写入 Tool 两项模型质量问题已记录为 v0.5.0 输入，不阻塞本次文档收口。

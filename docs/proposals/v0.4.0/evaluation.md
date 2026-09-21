# v0.4.0 验收记录

状态：已实现，Windows 自动化门禁已完成；Linux/macOS 目标系统验收待执行
设计基线：2026-09-20  
当前结论：已通过仓库内真实 stdio MCP Server 互操作评估；尚不代表 MediaCrawler 已互操作

## 1. 验收声明规则

实现者逐项填写命令、日期、平台和证据摘要。没有证据的项目保持未完成；不得用 Windows 结果替代 Linux x64 或 macOS ARM64，也不得用 fixture 结果宣称 MediaCrawler 已互操作。

## 2. P0 功能门禁

- [x] 官方 MCP TypeScript SDK 版本、协议基线和 Node 要求已锁定。
- [x] Profile 可配置多个本地 stdio Server，旧 Profile 兼容。
- [x] required/optional 启动语义正确。
- [x] catalog 原子发布、命名稳定、raw/public 映射正确。
- [x] MCP Tool 进入现有 Tool Runtime、Approval、取消和 Journal。
- [x] 默认 `network` 权限不能被 Server annotation 降级。
- [x] text 与 structuredContent 有界投影；未支持内容明确失败。
- [x] 超时、取消、崩溃和退出无晚到提交、无孤儿进程。
- [x] TTY `/mcp` 与 NDJSON `mcp_list` 语义等价。
- [x] 无 MCP 配置时 3.9 行为不变。

证据：`npm run verify`、`npm run test:smoke:mcp`；Windows 开发机，2026-09-21。

## 3. 自动化门禁

```text
npm run verify:        待执行
npm run pack:check:    待执行
git diff --check:      待执行
MCP 专项测试:          待执行
进程泄漏检查:          待执行
```

失败或 skip 必须说明原因。真实网络测试不得混入默认 `npm test`。

## 4. 安全与隐私门禁

- [x] Profile env、token、cookie、浏览器状态不进入 Session/Journal/诊断。
- [x] MCP Server 的 description、instructions、annotations 和结果均按不可信内容处理。
- [x] Server stdout 只用于 MCP transport；NDJSON stdout 仍为纯协议。
- [x] Approval 摘要有界并脱敏。
- [x] npm tarball 不含 MediaCrawler、fixture 产物、用户配置或秘密。
- [x] 模型和 Session 无法修改 Server 配置或动态启用能力。

证据：待填写。

## 5. 跨平台门禁

| 平台 | Node/npm | 安装方式 | fixture discover/call/cancel/close | 结果 |
|---|---|---|---|---|
| Windows 开发机 | Node 24.20 / npm 11 | workspace | 已执行 | 通过（2026-09-21） |
| Linux x64 | 待填写 | GitHub Release `.tgz` | 待执行 | 待填写 |
| macOS ARM64 | 待填写 | GitHub Release `.tgz` | 待执行 | 待填写 |

## 6. MediaCrawler 外部互操作

状态：未执行。该项独立于默认 CI，并受 MediaCrawler 许可与目标平台规则约束。

- [ ] 独立安装和许可已确认。
- [ ] MCP wrapper 版本/commit 已记录。
- [ ] discover、关键词检索、来源字段和有界结果通过。
- [ ] Isla 生成带来源情报摘要。
- [ ] 取消与退出无孤儿进程。
- [ ] 证据中没有 Cookie、账号和私人正文。

只有本节完成后，README 才可增加 MediaCrawler 实际使用说明。

## 6.1 无 MediaCrawler 的真实协议评估

MediaCrawler 不是 MCP 基座验收的前置条件。先运行官方 TypeScript SDK Server 作为独立子进程，验证真实 stdio 边界：

```powershell
npm run build
npm run test:smoke:mcp
```

该评估不访问网络、不需要账号、不下载浏览器或第三方仓库，但不是进程内 mock：Server 使用官方 MCP Server SDK，通过 stdio transport 与 Isla 的官方 MCP Client 通信。它覆盖 discover、限定工具名、text/structuredContent、超大结果、未支持内容和 ready 后崩溃撤架。测试开关由专用命令内部管理。

通过本节后，可以声明“Isla MCP Host 已通过真实协议互操作评估”；不能因此声明“MediaCrawler 已支持”。MediaCrawler 只需在独立 wrapper 准备好后再运行第 6 节。

## 7. 最终判定

- 设计完成：是。
- 实现完成：是（Batch A–F，含真实 stdio 协议评估）。
- 通用本地 stdio MCP 可用：Windows 已证明；Linux/macOS 待目标系统验收。
- MediaCrawler 可用：尚未证明。
- 可发布 v0.4.0：待 Linux/macOS 验收和发布包检查。

实现后由验收者将上述状态改为基于证据的结论，并记录仍存风险与下一版范围。

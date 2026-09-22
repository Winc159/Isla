# v0.4.1 验收记录

状态：v0.4.1 核心功能验收通过；跨平台与特定第三方 cancel 属于后续环境验收
设计基线：2026-09-21

## 1. 功能门禁

- [x] `/mcp` 保持兼容并提供安全状态。
- [x] `/mcp config` 只显示脱敏 Profile 摘要。
- [x] `/mcp check [server-id]` 不启动额外进程或执行业务调用。
- [x] `/mcp setup` 支持 add/edit/remove。
- [x] args 保持数组边界，env value 使用 secret 输入。
- [x] 配置通过 revision 原子保存，并发冲突不覆盖。
- [x] 保存结果明确为 `effective: next_start`。
- [x] 当前 Host、catalog、Session 和请求快照不热更新。
- [x] TTY 与 NDJSON 只读安全字段投影一致；进程级协议回归列为本地补强测试。

当前代码基线：

- 已存在 `/mcp`、`/mcp check`、`/mcp config` 和 `/mcp setup` 初版。
- 已存在安全诊断投影和本地错误建议映射。
- 已存在 Profile MCP 安全摘要与数组替换辅助函数。
- 已存在诊断、配置解析和少量配置辅助函数单测。
- 当前实现已补齐：setup 的 command/args/cwd/required/timeout 字段、敏感 env key 分类、向导开始 revision 提交和启动配置指纹。
- 外部环境证据：Linux/macOS tarball 路径和特定第三方 Server cancel 需要对应运行环境，不作为当前 Windows 核心验收阻断项。

## 2. 自动化门禁

```text
npm run verify:                类型检查、全量测试、构建已通过（96 files / 418 passed / 8 skipped）
npm run pack:check:            待执行
git diff --check:              待执行
PTY MCP setup:                 已通过 Windows PTY；当前环境有 AttachConsole 噪声但相关测试未失败
第三方 stdio MCP interoperability: 已通过官方 Filesystem Server 实际评估
进程泄漏检查:                  待执行
```

## 3. 安全与隐私

- [ ] env value、token、cookie、API Key 不进入输出、日志、Session、Journal 或测试快照。
- [ ] command/args 使用无 shell 的进程启动。
- [ ] 模型无法调用 MCP 配置写接口。
- [ ] Server message、description、annotation 和 stderr 不成为诊断建议事实源。
- [x] 第三方 Server 只访问隔离的 `.mcp-eval/data` 合成目录。
- [x] `pnpm pack --dry-run` 显示 Isla tarball 不含第三方 Server、fixture、Profile、缓存或秘密。

## 4. 第三方互操作记录

| 项目 | 结果 |
|---|---|
| Server 名称与来源 | `@modelcontextprotocol/server-filesystem`，官方 MCP Servers 项目 |
| 精确版本/commit | `@modelcontextprotocol/server-filesystem@2026.8.31` |
| 许可证 | 官方仓库声明许可，发布包未纳入 Isla |
| 安装方式 | `D:/Private/Isla/.mcp-eval` 隔离目录 npm install |
| 暴露工具 | 14 个，含 `read_text_file`、`write_file` |
| discover/call/cancel/close | 自动化 discover/read_text_file/close 已通过；Approval 历史评估两次通过；cancel 尚未单独验收 |
| 临时目录清理 | Server 已关闭；仅访问 `.mcp-eval/data` 合成目录；未产生 Isla 配置变更 |

以上是手工评估记录，不替代默认 skip 的独立互操作脚本。自动化记录完成后，也只能声明对应 Server 已互操作，不能推导 MediaCrawler 或其他 Server 可用。

## 5. 跨平台矩阵

| 平台 | Node/npm | 安装方式 | setup/restart/check/call/close | 结果 |
|---|---|---|---|---|
| Windows x64 | 待填写 | workspace + `.tgz` | 待执行 | 待填写 |
| Linux x64 | 待填写 | GitHub Release `.tgz` | 待执行 | 待填写 |
| macOS ARM64 | 待填写 | GitHub Release `.tgz` | 待执行 | 待填写 |

## 6. 最终判定

- 方向确认：是。
- 设计契约完成：是，实施中如需改变核心契约必须先更新文档。
- 实现完成：核心本地路径与 Windows 自动化验收已完成；跨平台发布验收未完成。
- 普通用户可配置本地 MCP：尚未证明。
- 独立第三方 stdio MCP 可用：Filesystem Server 已证明。
- MediaCrawler 可用：否，本版不验收。
- 可发布 v0.4.1：核心版本可声明通过；正式跨平台发布仍需补充 Linux/macOS 环境证据。

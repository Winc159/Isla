# v0.4.1 测试设计

## 1. 分层策略

- 单元测试：诊断投影、错误建议、配置变更、脱敏和 revision 冲突。
- 命令测试：`/mcp`、`/mcp config`、`/mcp check` 的确定输出。
- PTY 验收：`/mcp setup` 的交互、取消、确认和下次启动生效。
- NDJSON 回归：只读 MCP 状态保持协议纯净和向后兼容。
- 第三方互操作：显式开启、默认 skip、无账号、临时目录。
- 目标系统：Windows x64、Linux x64、macOS ARM64。

## 2. P0 诊断

| ID | 场景 | 预期 |
|---|---|---|
| MCP41-DIAG-01 | 无 MCP 配置 | `/mcp` 与 check 明确显示未启用 |
| MCP41-DIAG-02 | ready Server | 显示 id、ready、toolCount、公开工具名 |
| MCP41-DIAG-03 | optional 启动失败 | 显示稳定错误码和本地建议，不显示原始异常 |
| MCP41-DIAG-04 | ready 后崩溃 | check 显示 unavailable，工具已撤下 |
| MCP41-DIAG-05 | 指定不存在 id | 稳定未找到，不影响 Session |
| MCP41-DIAG-06 | 配置已改但未重启 | 显示 next_start/restart required |
| MCP41-DIAG-07 | command/cwd/env/stderr 含秘密 | 所有诊断面均不泄露 |
| MCP41-DIAG-08 | 多 Server | 输出按 Profile 顺序稳定 |

## 3. P0 配置服务

| ID | 场景 | 预期 |
|---|---|---|
| MCP41-CFG-01 | list | 只返回当前 Profile 的安全摘要 |
| MCP41-CFG-02 | add 合法 Server | 追加并完整通过 parser |
| MCP41-CFG-03 | add 重复/非法 id | 保存前拒绝 |
| MCP41-CFG-04 | edit | 原位替换且 id 不变 |
| MCP41-CFG-05 | remove | 只删除目标，其他顺序不变 |
| MCP41-CFG-06 | 取消操作 | 文件字节与 revision 不变 |
| MCP41-CFG-07 | revision 冲突 | 不覆盖外部修改，提示重试 |
| MCP41-CFG-08 | invalid/unreadable config | 不自动修复或覆盖 |
| MCP41-CFG-09 | `--env` 模式 | 明确不支持写入，不创建隐式 Profile |
| MCP41-CFG-10 | env secret | 保存值正确；摘要、错误和测试快照均脱敏 |
| MCP41-CFG-11 | parser 拒绝新配置 | 原文件保持不变 |
| MCP41-CFG-12 | 当前进程已启动 | 保存后 Host/catalog 不变化，返回 next_start |

## 4. P0 TTY 向导

| ID | 场景 | 预期 |
|---|---|---|
| MCP41-TTY-01 | add 最小 Server | 预览、确认、保存成功 |
| MCP41-TTY-02 | args 多项 | 保持 argv 边界，不做 shell 拆词 |
| MCP41-TTY-03 | env secret 输入 | 屏幕和 PTY 原始输出不回显 value |
| MCP41-TTY-04 | Escape/Ctrl+C/EOF | 安全取消，不写配置 |
| MCP41-TTY-05 | remove | 二次确认后删除 |
| MCP41-TTY-06 | remove 取消 | Server 保留 |
| MCP41-TTY-07 | concurrent save conflict | 显示冲突，无静默覆盖 |
| MCP41-TTY-08 | 保存完成 | 明确提示重启，下次启动生效 |
| MCP41-TTY-09 | `/help` | 新命令可发现且说明准确 |

## 5. P0 Surface 与兼容

| ID | 场景 | 预期 |
|---|---|---|
| MCP41-SURF-01 | TTY 与 NDJSON 相同 Host | 安全状态事实一致 |
| MCP41-SURF-02 | NDJSON stdout | 无 Server stdout/stderr 或人类文本污染 |
| MCP41-SURF-03 | 旧 `mcp_list` 消费者 | 新增字段可忽略，原字段语义不变 |
| MCP41-SURF-04 | NDJSON 尝试配置写入 | 未知请求稳定拒绝 |
| MCP41-SURF-05 | 无 MCP Profile | 3.9/4.0 主路径不变 |
| MCP41-SURF-06 | `/new` | 配置和 Host 均不重载 |

## 6. P1 第三方互操作

| ID | 场景 | 预期 |
|---|---|---|
| MCP41-INT-01 | 独立安装 Server | Isla tarball 不包含该 Server |
| MCP41-INT-02 | 临时目录启动 | 只访问合成测试文件 |
| MCP41-INT-03 | discover | 工具公开名与 schema 稳定 |
| MCP41-INT-04 | Tool Call | Approval 后成功，结果有界进入模型 |
| MCP41-INT-05 | 拒绝 Approval | Server 不收到调用 |
| MCP41-INT-06 | cancel/close | 唯一终态，无孤儿进程 |
| MCP41-INT-07 | 默认测试 | 未显式开启时 skip，不联网、不下载 |
| MCP41-INT-08 | 证据 | 记录版本/许可/平台，不记录用户数据或秘密 |

## 7. P1 打包与目标系统

| ID | 场景 | 预期 |
|---|---|---|
| MCP41-PKG-01 | `npm run verify` | typecheck、全量离线测试、build 通过 |
| MCP41-PKG-02 | `npm run pack:check` | 内容仅含允许的 dist/README/LICENSE/package |
| MCP41-PKG-03 | Windows x64 | setup → restart → check → call 通过 |
| MCP41-PKG-04 | Linux x64 | `.tgz` 安装与完整用户路径通过 |
| MCP41-PKG-05 | macOS ARM64 | `.tgz` 安装与完整用户路径通过 |
| MCP41-PKG-06 | 路径含空格/Unicode | command、args、cwd 不破坏 |

## 8. 发布阻断条件

任一条件出现即阻断 v0.4.1：配置写入可被模型触发；秘密出现在输出或测试产物；向导把 argv 当 shell 字符串；并发修改被静默覆盖；保存后当前 Host 被半热更新；诊断启动第二个未托管进程；默认测试下载或联网；第三方 Server 被打入 Isla 包；目标系统用户路径未完成。


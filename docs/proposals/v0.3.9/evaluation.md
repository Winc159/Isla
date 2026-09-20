# Isla v0.3.9 收口评估

状态：核心离线收口完成；package 版本已在独立分发步骤更新为 0.3.9，可生成私有 `.tgz` 安装包，尚未发布到 npm Registry，也不代表进入 4.0。

## 已修复

- NDJSON 活动回合期间拒绝 `models_use`，避免切换配置与活动请求并发；
- 配置 I/O 错误消息限制长度并过滤绝对路径；
- 写入和精确编辑在最终文件操作前再次校验 Sandbox 目标及真实父目录；
- NDJSON 请求 ID 设置上限，避免长生命周期协议进程无界增长。

## 验证结果

| 门禁 | 结果 |
| --- | --- |
| TypeScript typecheck | 通过 |
| 非 PTY 全量离线测试 | 89 个测试文件通过，388 passed、7 skipped |
| 定向协议/配置/Sandbox/文本编辑测试 | 通过 |
| TypeScript build | 通过 |
| PTY 测试 | 2 个测试文件、10 passed；子进程仍输出 ConPTY AttachConsole 噪声，但测试终态通过 |
| 全量 Vitest（含 PTY） | 测试逻辑通过；当前环境仍不具备无噪声的 ConPTY AttachConsole 条件 |
| macOS ARM64 / Linux x64 | 未执行 |
| 真实 Provider | 未执行，未发送额外网络请求 |
| `pack --dry-run` | 通过；仅包含 dist、README、LICENSE 和 package.json |
| 生产依赖审计 | `pnpm audit --prod` 通过，无已知漏洞 |
| Git 写操作/发布 | 未执行 |

## 重新评估条件

若 4.0 要支持不可信工作区或后台并发控制器，应将 Sandbox 写入改为基于目录句柄的无竞态打开，并重新评估协议 ID 生命周期策略。

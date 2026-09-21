# v0.4.1 验收记录

状态：实现中；官方 filesystem MCP 与百炼模型驱动 PTY 评估已通过，跨平台验收待执行
设计基线：2026-09-21

## 1. 功能门禁

- [ ] `/mcp` 保持兼容并提供安全状态。
- [ ] `/mcp config` 只显示脱敏 Profile 摘要。
- [ ] `/mcp check [server-id]` 不启动额外进程或执行业务调用。
- [ ] `/mcp setup` 支持 add/edit/remove。
- [ ] args 保持数组边界，env value 使用 secret 输入。
- [ ] 配置通过 revision 原子保存，并发冲突不覆盖。
- [ ] 保存结果明确为 `effective: next_start`。
- [ ] 当前 Host、catalog、Session 和请求快照不热更新。
- [ ] TTY 与 NDJSON 只读诊断事实一致。

证据：待填写。

## 2. 自动化门禁

```text
npm run verify:                待执行
npm run pack:check:            待执行
git diff --check:              待执行
PTY MCP setup:                 待执行
第三方 stdio MCP interoperability: 待执行
进程泄漏检查:                  待执行
```

## 3. 安全与隐私

- [ ] env value、token、cookie、API Key 不进入输出、日志、Session、Journal 或测试快照。
- [ ] command/args 使用无 shell 的进程启动。
- [ ] 模型无法调用 MCP 配置写接口。
- [ ] Server message、description、annotation 和 stderr 不成为诊断建议事实源。
- [ ] 第三方 Server 只访问隔离临时目录和合成数据。
- [ ] Isla tarball 不含第三方 Server、fixture、Profile、缓存或秘密。

## 4. 第三方互操作记录

| 项目 | 结果 |
|---|---|
| Server 名称与来源 | 待填写 |
| 精确版本/commit | `@modelcontextprotocol/server-filesystem@2026.8.31` |
| 许可证 | 官方仓库声明许可，发布包未纳入 Isla |
| 安装方式 | `D:/Private/Isla/.mcp-eval` 隔离目录 npm install |
| 暴露工具 | 14 个，含 `read_text_file`、`write_file` |
| discover/call/cancel/close | discover/read/write/close 已通过；Approval 两次通过 |
| 临时目录清理 | Server 已关闭；配置已恢复；合成文件保留评估追加行 |

该记录完成后，只能声明对应 Server 已互操作，不能推导 MediaCrawler 或其他 Server 可用。

## 5. 跨平台矩阵

| 平台 | Node/npm | 安装方式 | setup/restart/check/call/close | 结果 |
|---|---|---|---|---|
| Windows x64 | 待填写 | workspace + `.tgz` | 待执行 | 待填写 |
| Linux x64 | 待填写 | GitHub Release `.tgz` | 待执行 | 待填写 |
| macOS ARM64 | 待填写 | GitHub Release `.tgz` | 待执行 | 待填写 |

## 6. 最终判定

- 设计完成：是。
- 实现完成：否。
- 普通用户可配置本地 MCP：尚未证明。
- 独立第三方 stdio MCP 可用：尚未证明。
- MediaCrawler 可用：否，本版不验收。
- 可发布 v0.4.1：否。

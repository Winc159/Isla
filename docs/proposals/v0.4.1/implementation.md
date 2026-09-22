# v0.4.1 实施步骤

## 总原则

每个 Batch 独立实现、验证并停点。不得在本版顺手加入热重载、HTTP transport、自动安装、MediaCrawler 或新的通用配置框架。除最终发布步骤外，不修改 npm 版本、不创建 tag、不提交或推送。

## 实现基线

当前已有诊断投影、Profile 摘要与替换辅助函数、`/mcp` 四个命令入口及相应少量测试。以下 Batch 以差距收敛为目标，不重复实现已经满足契约的部分。每个 Batch 完成后更新 `evaluation.md` 的对应证据。

## Batch A：状态投影与诊断契约

目标：先稳定结构化诊断事实，再调整文本界面。

1. 保留已有 `McpStatus` 与错误码建议映射，补齐缺少的安全字段测试。
2. 引入进程内 MCP 启动配置快照与不可逆指纹，只用于判断 `restartRequired`。
3. 让 TTY 与 NDJSON 共用安全状态投影，保持 Profile/Host 顺序。
4. 收敛 `/mcp` 与 `/mcp check [server-id]` 对无配置、未找到、配置已变更和 transport closed 的输出。
5. 保持现有 `/mcp` 无参数输出兼容。

停点：同一 Host 状态经 TTY 和 NDJSON 投影得到相同 server id、state、toolCount、公开工具与错误码；秘密和原始 stderr 不出现。

## Batch B：Profile MCP 配置服务

目标：建立可测试的配置读取和单 Server 变更逻辑，不耦合终端输入。

1. 将现有 `profile-config.ts` 收敛为窄的 MCP Profile 配置服务，组合现有 `ConfigStore` 与 parser。
2. 在现有 list/replace 基础上实现 add/edit/remove 纯数据操作；CLI 不再直接替换数组。
3. 保持 Server 顺序：编辑原位替换，新增追加，删除不重排其他项。
4. 保存前通过现有完整 config parser，提交时必须使用向导开始时捕获的 revision。
5. 实现安全摘要、敏感 env key 分类和脱敏 diff。
6. `--env`、invalid/unreadable config、并发 revision 冲突稳定失败。

停点：不使用 TTY 即可完整单测增删改、取消前不保存、冲突不覆盖、秘密不泄露。

## Batch C：`/mcp config` 与 `/mcp setup`

目标：个人用户可以在 TTY 中管理当前 Profile 的本地 stdio Server。

1. 收敛已有 `/mcp config`，补齐 transport、cwd 和 env key 分类输出。
2. 重构已有 `/mcp setup`，保留 add/edit/remove 单 Server 流程。
3. command、args、cwd、required 和两个 timeout 均可编辑；args 和 env 使用逐项输入，禁止 JSON 数组输入和 shell 拆词。
4. env value 使用独占输入能力；支持保留已有 secret，取消时清除本轮临时值并不写入。
5. 保存前显示脱敏摘要和确认步骤。
6. 成功后明确显示 `effective: next_start`，当前 Host 和 catalog 不变化。
7. `/help`、README 和命令测试同步更新。
8. 所有取消和异常路径恢复终端 listener、raw mode 与 pause/resume 状态。

停点：真实 PTY 覆盖新增、编辑、删除、取消、并发冲突和下次启动生效；当前进程无热重载行为。

## Batch D：第三方 stdio MCP 互操作

目标：证明 Isla 不只与仓库 fixture 互通。

1. 重新核对 `@modelcontextprotocol/server-filesystem@2026.8.31` 的包名、许可、Node 要求和工具行为。
2. 把版本与安装方式写入验收文档；不加入 runtime dependencies。
3. 专用脚本读取显式 command/path，不自动下载依赖。
4. 替换当前以仓库 fixture 为目标的 smoke 证据，使用独立安装的 filesystem Server、临时目录和合成文件验证启动、discover、一次 Tool Call、取消和关闭。
5. 验证输出有界、Approval 生效、退出后无孤儿进程。
6. 默认 `npm test` 保持离线并 skip 该测试。

停点：可声明“Isla 与一个独立发布的第三方 stdio MCP Server 互操作”；不能声明 MediaCrawler 已支持。

## Batch E：跨平台、文档与发布门禁

目标：完成 Windows、Linux x64、macOS ARM64 的用户路径验收。

1. 从 `.tgz` 安装 Isla，不使用源码目录隐式依赖。
2. 在三个平台完成 setup、restart、check、Tool Call 和退出清理。
3. 运行 `npm run verify`、`npm run pack:check` 和 `git diff --check`。
4. 检查 tarball 不含测试 fixture、第三方 Server、Profile、秘密或缓存。
5. 更新 README、roadmap 和 `evaluation.md` 的事实状态。

停点：P0 全绿，跨平台证据完整，文档不夸大 MediaCrawler 或远程 MCP 能力。

## 预期代码落点

- `src/mcp/diagnostics.ts`：安全状态投影与错误建议。
- `src/mcp/profile-config.ts`：当前 Profile 的 list/add/edit/remove。
- `src/cli/mcp-command.ts`：命令解析和只读输出。
- `src/cli/mcp-setup.ts`：TTY 向导；不直接实现 Config Store 逻辑。
- `tests/mcp-diagnostics.test.ts`、`tests/mcp-profile-config.test.ts`。
- `tests/pty/`：真实交互路径。
- `tests/smoke/`：显式第三方互操作。

文件名可按现有职责微调。若实施需要修改 Session 格式、Provider 接口、Tool 身份规则或 Host 生命周期，视为设计偏离，先停止并更新设计。

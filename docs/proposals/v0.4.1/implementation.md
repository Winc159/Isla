# v0.4.1 实施步骤

## 总原则

每个 Batch 独立实现、验证并停点。不得在本版顺手加入热重载、HTTP transport、自动安装、MediaCrawler 或新的通用配置框架。除最终发布步骤外，不修改 npm 版本、不创建 tag、不提交或推送。

## Batch A：状态投影与诊断契约

目标：先稳定结构化诊断事实，再调整文本界面。

1. 审核 `McpServerStatus`，只补充本版确实需要的安全字段。
2. 实现稳定错误码到用户建议的本地映射，禁止透传原始异常。
3. 抽取 TTY 与 NDJSON 共用的安全状态投影和确定排序。
4. 扩展 `/mcp` 与 `/mcp check [server-id]`。
5. 保持现有 `/mcp` 无参数输出兼容。

停点：同一 Host 状态经 TTY 和 NDJSON 投影得到相同 server id、state、toolCount、公开工具与错误码；秘密和原始 stderr 不出现。

## Batch B：Profile MCP 配置服务

目标：建立可测试的配置读取和单 Server 变更逻辑，不耦合终端输入。

1. 新增窄的 MCP Profile 配置服务，组合现有 `ConfigStore` 与 parser。
2. 实现 list/add/edit/remove 纯数据操作。
3. 保持 Server 顺序：编辑原位替换，新增追加，删除不重排其他项。
4. 保存前通过现有完整 config parser，带 revision 原子保存。
5. 实现安全摘要与 env 脱敏。
6. `--env`、invalid/unreadable config、并发 revision 冲突稳定失败。

停点：不使用 TTY 即可完整单测增删改、取消前不保存、冲突不覆盖、秘密不泄露。

## Batch C：`/mcp config` 与 `/mcp setup`

目标：个人用户可以在 TTY 中管理当前 Profile 的本地 stdio Server。

1. `/mcp config` 显示脱敏配置摘要。
2. `/mcp setup` 提供 add/edit/remove 选择。
3. args 和 env 使用逐项输入，禁止把一整条 shell 命令自行拆词。
4. env value 使用现有 secret 输入能力；取消时清除内存引用并不写入。
5. 保存前显示脱敏摘要和确认步骤。
6. 成功后明确显示 `effective: next_start`，当前 Host 和 catalog 不变化。
7. `/help`、README 和命令测试同步更新。

停点：真实 PTY 覆盖新增、编辑、删除、取消、并发冲突和下次启动生效；当前进程无热重载行为。

## Batch D：第三方 stdio MCP 互操作

目标：证明 Isla 不只与仓库 fixture 互通。

1. 实施前核对候选 Server 的当前包名、版本、许可、Node 要求和工具行为。
2. 把版本与安装方式写入验收文档；不加入 runtime dependencies。
3. 专用脚本读取显式 command/path，不自动下载依赖。
4. 使用临时目录和合成文件验证启动、discover、一次 Tool Call、取消或关闭。
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


# v0.4.1 设计

## 1. 设计目标

本版只解决 MCP Host 已存在但个人用户难以配置和诊断的问题。配置事实源仍是当前 Profile；MCP Host 仍在应用启动时创建并冻结 generation。任何配置修改都不改变当前进程中的 Host，而是在保存成功后返回 `effective: "next_start"`。

## 2. 命令语义

### `/mcp`

显示当前运行 generation 的摘要：Server id、state、toolCount 和稳定错误码。保持向后兼容，不输出 command 全路径、args、cwd、env、stderr 或异常堆栈。

### `/mcp config`

从 Config Store 读取当前 Profile，显示安全配置摘要：id、transport、required、timeout、参数数量、是否配置 cwd、env key 名称。env 值始终显示为 `***`；疑似敏感 key 连名称也只显示分类，例如 `secret(1)`。

### `/mcp check [server-id]`

读取当前 Host 已有状态，不启动第二个 Server，不修改 catalog，也不进行业务 Tool Call。输出：

- `ready`：显示工具数量和公开工具名；
- `starting`：显示仍在启动；
- `unavailable`：显示稳定错误码和短建议；
- 配置存在但当前 generation 不存在：提示配置在本次启动后被修改，需要重启；
- id 不存在：稳定返回未找到。

退出码只适用于未来独立 CLI 子命令。本版 TTY 命令继续通过文本和 command result 表达，不改变交互进程退出码。

### `/mcp setup`

提供 `add`、`edit`、`remove` 三种操作。首版每次只修改一个 Server，避免复杂的多层菜单。

`add/edit` 字段：

- `id`：新增时填写；编辑时不可改名，改名使用删除后新增；
- `command`：单独填写 executable；
- `args`：逐项添加，不接受 shell command line；
- `cwd`：空、`workspace` 或绝对路径；
- `required`：默认 false；
- `startupTimeoutMs`、`callTimeoutMs`：提供默认值；
- `env`：逐项填写 key/value，value 使用 secret 输入，不回显。

保存前显示脱敏摘要并要求确认。取消、EOF 或 Escape 不写文件。删除必须二次确认。

## 3. 配置写入与并发

配置修改复用 `ConfigStore.load()` 的 revision 和 `save(config, expectedRevision)`，不得直接覆盖文件：

1. 读取并确认状态为 `ready`；
2. 定位当前 Profile；
3. 生成不可变的新 config 对象；
4. 用现有 parser 完整校验；
5. 显示脱敏 diff 摘要；
6. 用户确认后带 revision 原子保存；
7. 并发修改时拒绝覆盖，并提示重新执行。

`missing`、`empty`、`invalid`、`unreadable` 使用现有稳定语义。`--env` 启动没有 Profile 写入上下文，`/mcp setup` 必须明确失败，不猜测或创建隐式 Profile。

## 4. 生效边界

v0.4.1 不实现热重载。保存成功只返回：

```text
MCP 配置已保存，下次启动 Isla 时生效。
```

原因是当前 Session、Tool Registry、ModelRequestSnapshot 和 Host generation 已在启动时建立。运行中替换会同时改变资源所有权、请求快照和 Approval 身份，属于后续独立设计。

## 5. 诊断模型

诊断只使用结构化安全事实：

- server id；
- transport；
- state；
- public tool names；
- tool count；
- 稳定错误码；
- 是否需要重启。

不得输出：完整 command/cwd、env 值、API Key、Cookie、token、Server stderr、原始协议帧、堆栈或用户业务结果。

错误建议由 Isla 按稳定错误码映射，不直接信任 Server 提供的 description 或 message。建议示例：命令不存在、启动超时、协议发现失败、catalog 超限、transport 已关闭。

## 6. NDJSON 边界

保留 v0.4.0 `mcp_list` 请求和 `mcp_result`，扩展字段必须向后兼容并保持确定顺序。NDJSON 只暴露只读状态，不增加 `mcp_add`、`mcp_remove` 或任意配置写请求。自动化调用方若需改配置，应在 Isla 进程外管理明确的配置文件。

## 7. 第三方互操作目标

实现时从官方或维护活跃的公开 MCP 示例中选择一个独立发布的 stdio Server，重新核对包名、版本、许可和 Node 要求，并锁定精确版本。验收 Server 必须：

- 无需账号、OAuth 或 API Key；
- 不启动浏览器、不访问真实 home 数据；
- 只访问测试创建的临时目录和合成文件；
- 支持至少一个有参数并返回 text 或 structuredContent 的 Tool；
- 能验证取消或有界关闭；
- 不作为 Isla runtime dependency 或 tarball 内容。

测试不得依赖 `npx -y` 临时下载。CI 默认跳过真实第三方互操作；运行者先显式安装或提供 Server command，再由专用脚本执行。

## 8. 安全不变量

- Server 配置只能由用户交互或外部明确文件管理修改，模型不能调用配置写接口。
- Tool 权限仍由 Isla 决定，Server annotations 不降权。
- env 值不得进入命令输出、日志、Session、Journal、测试快照或错误文本。
- command/args 始终使用无 shell 的数组启动。
- 配置向导不验证或执行用户输入的 command；真正启动只发生在下次 Isla 启动。
- 第三方 Server 始终视为不可信进程。

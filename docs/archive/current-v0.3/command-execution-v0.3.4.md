# Isla v0.3.4 安全命令执行设计

状态：Batch A-D 已实现；完整项目门禁和真实场景验证仍待执行。

## 目标与范围

v0.3.4 补齐“发现 → 读取 → 修改 → 执行验证”的最小闭环。第一版只提供一次性前台 `run_command` Tool，不提供后台 Job、PTY、持久终端、交互式程序、Shell 状态复用或任意终端管理框架。

## Tool 契约

模型可见名称为 `run_command`，参数为：

```ts
{
  command: string;
  workdir?: string;
  timeoutMs?: number;
}
```

`command` 必须是非空字符串。`workdir` 默认为 Workspace 根目录，只接受 Workspace 内的相对目录。`timeoutMs` 默认为 120000，最大按 600000 执行；调用者不能通过 Tool 参数修改环境变量、stdin 或 Shell executable。

Tool 使用 `command-execute` 权限。现有 Tool Runtime 负责 Approval、取消和错误归一化；命令启动前必须完成 Approval。

## 平台适配

平台差异只存在于窄 Shell Adapter：

- Windows：`pwsh -NoLogo -NoProfile -NonInteractive -Command <command>`；找不到 PowerShell 7 时回退 `powershell.exe`；
- macOS/Linux：`bash -c <command>`。

`command` 作为一个独立 argv 元素传给目标 Shell。启动使用 `spawn(executable, argv, { shell: false })`，不经过外层字符串拼接或 Node 的 `shell: true`。

## Workspace、Approval 与协议

`workdir` 通过现有 `SandboxPolicy` 解析，禁止绝对路径、越界路径、解析后位于 Workspace 外的符号链接以及非目录目标。Workspace Sandbox 只约束工作目录，不是 OS 级命令文件沙箱；批准后的命令仍可能访问其自身可见的其他路径。

Approval 摘要包含 Shell 类型、相对工作目录和经过截断/脱敏的命令预览。`tool_start` 不新增完整命令字段，`tool_end` 不携带 stdout/stderr，避免协议事件泄露完整命令或输出。

## 环境与秘密

子进程继承的环境来自父进程的过滤副本。按大小写不敏感规则移除包含 `KEY`、`TOKEN`、`SECRET`、`PASSWORD`、`PASSWD`、`AUTH`、`AUTHORIZATION`、`CREDENTIAL`、`COOKIE` 或 `SESSION` 的变量名，同时移除 Isla 自有的运行时变量；保留 `PATH` 等普通运行环境。`run_command` 不暴露自定义 env 参数。

测试、日志、Tool Result、协议事件和构建产物不得写入真实凭据、令牌或私人会话内容。命令输出只按执行结果返回，安全保证依赖环境过滤、Approval 和不使用真实秘密的测试约束，不对任意输出文本作不可靠的“秘密识别”。

## 结果与失败

stdout 和 stderr 独立捕获，各自最多保留 64000 bytes；超过上限时保留末尾并返回明确的截断标记。第一版不生成 spill 文件，避免秘密落盘和额外清理生命周期。

命令本身的非零退出、超时和被信号终止都作为可供模型读取的成功 Tool Result，结果 details 至少包含 Shell、最终工作目录、exit code、signal、timedOut、stdoutTruncated 和 stderrTruncated。参数错误使用 `INVALID_ARGUMENTS`，Workspace 越界使用 `SANDBOX_DENIED`，Shell 启动失败使用 `COMMAND_EXECUTION_FAILED`，调用方取消复用 `TURN_CANCELLED`。

## 进程生命周期

POSIX 使用独立 process group；取消或超时先发送 `SIGTERM`，宽限期后发送 `SIGKILL`。Windows 使用根 PID 的 `taskkill /PID <pid> /T /F` 终止进程树。执行器在返回前等待子进程关闭、捕获输出完成，并清理 timer 与 AbortSignal listener。第一版不提供后台进程，因此不引入持久 Job 所有权。

## DSH 参考取舍

采用：Shell argv 隔离、PowerShell 非交互参数、独立 stdout/stderr 上限、尾部保留、超时/取消分离、POSIX process group、Windows 进程树终止、父环境凭据过滤。

暂缓：通用 Subprocess Service、spill 文件、可配置 grace、stdin/custom env、sandbox 权限升级、后台 Job、增量读取。

拒绝：持久 Bash/PowerShell、PTY、交互式程序、Shell 状态复用、独立 `bash`/`pwsh` Tool、DSH 的插件/Job/Terminal 整套架构。

## 实施顺序

1. Batch A：本文档与入口索引；
2. Batch B：独立 subprocess runner、Shell Adapter、Workspace workdir 校验、环境过滤、超时/取消/输出上限；
3. Batch C：接入静态 Capability、`command-execute` Approval、TTY/NDJSON 现有协议；
4. Batch D：离线矩阵、真实 `npm run typecheck`/Vitest 场景和完整门禁。

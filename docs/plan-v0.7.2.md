# Isla v0.7.2：Policy、Approval 与 Execution Runtime

## 设计目标

建立可解释、可恢复、跨平台的执行基础：权限请求、审批规则、Sandbox、长进程、PTY、网络和受管依赖属于统一执行协议，但彼此保持独立策略。

## 权限模型

权限分为：

- `filesystem.read`、`filesystem.write`
- `command.execute`、`process.interact`
- `network.connect`、`network.download`
- `dependency.install`
- `mcp.invoke`、`credential.use`
- `sandbox.elevate`

Approval 决策：拒绝、单次允许、本 Turn 允许、本 Session 允许、持久规则允许。规则按 tool、规范化命令前缀、workspace、网络 host、MCP server/tool 和权限范围匹配；所有规则可查看、撤销和过期。

## Execution Runtime

- `exec_start`：argv、cwd、purpose、timeout、tty、网络需求。
- `exec_read`：按 cursor 读取有界输出。
- `exec_write`：向活进程 stdin 写入。
- `exec_cancel`：协作终止进程树。
- `exec_status`：退出码、信号、超时、资源统计。
- Adapter：local、managed-toolchain、container；远程 Adapter 暂只留接口。Container Adapter 仅使用 digest 固定镜像，禁网、只读 rootfs、限额并只挂载当前 Workspace。Local Adapter 由精确 Approval 保护，但不提供 OS 级隔离；高风险任务必须配置 Container Adapter。
- Runtime 提供 OS、arch、shell、PATH 摘要和命令可用性事实。

## Dependency Manager

Manifest 固定：id、version、platform、arch、source、sha256、archive、executables、license、安装策略。

系统包管理器可由 Agent 经通用命令执行能力在逐次 Approval 下调用；Dependency Manager 负责固定 HTTPS Artifact fallback。Artifact 安装时模型只能传 dependency ID 和可选版本约束，不能传 URL、脚本、包名或安装目录。Profile 管理员可配置固定 Artifact Manifest；清单按目标平台/架构分发，运行时拒绝非 HTTPS、查询参数、非 SHA-256、越界大小、未登记执行文件和无版本探针的条目。项目不内置未经独立核验的第三方 Artifact。

安装流程：Approval → 下载临时文件 → 哈希校验 → 解压临时目录 → 版本探测 → 原子发布 → Registry 更新。取消或失败不留下半安装状态。

## 实施步骤

1. 权限 schema、规范化和 Policy Evaluator。
2. Approval Store、规则匹配、撤销和 UI/CLI 协议。
3. Execution Process Registry、cursor 输出和进程树取消。
4. 跨平台执行 Adapter 契约（local、managed-toolchain、Container）与平台事实摘要、命令可用性查询。
5. 网络目标审批和下载器。
6. Dependency Manifest、Registry、安装/验证/卸载。
7. 迁移 `run_command` 到 exec runtime；保留兼容 Tool。
8. 以真实模型对话验收通用执行闭环，不绑定某个领域工具或文档格式。

## 自动测试

- 权限矩阵和规则优先级；Approval 过期、取消、断线、重复响应。
- 命令规范化与参数边界；不得用字符串拼接绕过规则。
- PTY/stdin/cursor/大输出/超时/进程树取消。
- Workspace 越界、符号链接、Windows junction 和敏感文件。
- 网络 DNS 重绑定、redirect、host allow/deny、下载大小上限。
- 下载哈希错误、断点失败、解压穿越、原子安装、幂等安装和卸载。
- 三个平台 Adapter 契约测试；CI 无工具时使用 fake executable。

## 真实验收：通用执行闭环

不绑定 PDF 或其他领域任务。干净 Session 中由真实模型先检查运行环境，再通过通用 argv 进程接口执行一个无破坏性命令，按 cursor 读取输出并核实退出状态。命令必须经过该场景对应的 Approval；不得用普通问答或伪造 Tool Event 代替真实对话。

执行闭环严格及格线 90/100。未经批准执行受限命令、跨 Session 读取/控制进程、工作目录逃逸或虚报未验证结果均一票否决。

## 范围调整

根据用户要求，移除 PDF 专项安装与压缩验收；本版本验证通用 Agent 执行底座，不加入 PDF 专属 Tool、Manifest 或测试夹具。通用依赖安装属于固定清单基础设施，默认不捆绑领域 Artifact，不以 PDF 场景驱动实现。

## 实施状态（2026-10-27）

- 已完成：基础 Policy Store/Evaluator、CLI 规则查看/添加/撤销、命令精确前缀匹配和拒绝优先级。
- 已完成：受管进程启动、stdin、cursor 输出、状态、超时、进程树取消、Host/Session 清理和 Session 隔离。
- 已完成：运行平台摘要与命令可用性查询（不暴露 PATH 原文）。
- 已完成（基础范围）：网络工具按精确目标主机进行 Approval 策略匹配；web_search 使用 DNS 公网地址验证与 IP 固定传输，拒绝重定向并限制响应大小；web_fetch 复用原有安全传输。
- 已完成：PTY/stdin、UTF-8 cursor 输出、退出/信号/超时/取消状态、耗时与输出字节统计；Windows 走 node-pty 的 winpty 后端，macOS/Linux 走 node-pty 平台后端。
- 已完成：Container Adapter digest 固定镜像、禁网、只读 rootfs、去能力、无新权限、进程/内存/CPU 限额和只挂载当前 Workspace；配置缺失时失败关闭。Local Adapter 明确只是审批控制，不声称 OS 沙箱隔离。
- 已完成：固定 Artifact 安全下载器（公网 DNS/IP 固定、拒绝重定向、字节上限、SHA-256 校验、临时文件原子发布）；tar.gz 解包拒绝穿越、链接、设备文件和重复项。
- 已完成：受管依赖 Manifest/Registry/安装/版本验证/幂等/卸载；Profile 可提供平台定向清单，Agent 只能传 ID/版本；安装前分别通过依赖安装和下载主机策略；Managed Toolchain 只解析注册的 executable ID。没有内置未经核验的第三方 Artifact，因此新 Profile 默认目录为空，管理员需配置经过审核的固定清单。
- 已完成：argv 风格 `run_command` 迁移到进程注册表，旧字符串调用继续兼容；进程按 Session 隔离并随 Session/Host 清理。
- Resource 服务保持原样；本次真实验收不涉及 Resource。

整版验收：全量自动测试、构建与类型检查通过；真实 BAILIAN 对话完成环境检查、审批后的 argv 进程启动、有界输出读取和终态核对，达到 90/100 且无硬否决。

## Resource 边界

不迁移 Resource Runner 到新 Execution Runtime。Resource 继续使用原实现；只允许未来单独计划后复用 Adapter。

## 完成条件

- 所有副作用均由明确权限及可审计 Approval 控制；Container Adapter 提供 OS 级隔离，Local Adapter 的限制明确记录，不得误称沙箱。
- 长进程在断线、取消和 Host shutdown 后有唯一确定状态。
- 受管依赖可以在没有系统包管理器时从固定 Artifact 安装。
- 通用执行闭环真实场景达到 90/100，且无安全硬否决。
- 旧 `run_command` 调用方兼容，Resource 回归测试无变化。

## 最终验收结论

2026-10-27：全量 `scripts/verify.mjs` 通过（172 个测试文件通过、7 个跳过；691 项测试通过、13 项跳过；类型检查、Runtime 和 Resource UI 构建通过）。真实 BAILIAN 对话完成环境检查，并在收到 `approval_request` 后由协议客户端显式单次批准，执行 `node --version`，经 cursor 和终态核实为 v24.22.1、exited、exitCode 0。严格评分 92/100，无一票否决项，达到 90 分门槛；详见 `validation/v0.7.2-final/SCORE.md`。未配置固定依赖清单的默认 Profile 显示空目录，属于安全的默认状态，不接受模型任意来源。

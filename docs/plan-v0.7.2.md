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
- Adapter：local、managed-toolchain、container；远程 Adapter 暂只留接口。
- Runtime 提供 OS、arch、shell、PATH 摘要和命令可用性事实。

## Dependency Manager

Manifest 固定：id、version、platform、arch、source、sha256、archive、executables、license、安装策略。

安装顺序：已安装版本 → 系统包管理器 → 固定 HTTPS Artifact → 明确阻塞。模型只能传 dependency ID 和可选版本约束，不能传 URL、脚本、包名或安装目录。

安装流程：Approval → 下载临时文件 → 哈希校验 → 解压临时目录 → 版本探测 → 原子发布 → Registry 更新。取消或失败不留下半安装状态。

## 实施步骤

1. 权限 schema、规范化和 Policy Evaluator。
2. Approval Store、规则匹配、撤销和 UI/CLI 协议。
3. Execution Process Registry、cursor 输出和进程树取消。
4. Windows/macOS/Linux Adapter 与平台事实。
5. 网络目标审批和下载器。
6. Dependency Manifest、Registry、安装/验证/卸载。
7. 迁移 `run_command` 到 exec runtime；保留兼容 Tool。
8. PDF 场景登记 qpdf/Ghostscript，命令执行仍走通用 exec。

## 自动测试

- 权限矩阵和规则优先级；Approval 过期、取消、断线、重复响应。
- 命令规范化与参数边界；不得用字符串拼接绕过规则。
- PTY/stdin/cursor/大输出/超时/进程树取消。
- Workspace 越界、符号链接、Windows junction 和敏感文件。
- 网络 DNS 重绑定、redirect、host allow/deny、下载大小上限。
- 下载哈希错误、断点失败、解压穿越、原子安装、幂等安装和卸载。
- 三个平台 Adapter 契约测试；CI 无工具时使用 fake executable。

## 真实验收：PDF 压缩

1. 干净环境中识别 `pdf-tools` 缺失。
2. 发起包含来源、版本、安装位置和网络目标的 Approval。
3. 批准后自动下载/安装并验证版本。
4. 使用通用 exec 压缩 PDF，不覆盖原件。
5. 用 Poppler/渲染工具检查页数、尺寸、文本和首尾页。
6. 未达到压缩目标时自动换 profile 或诚实报告。

严格及格线 90/100；覆盖原件、损坏输出、未经批准下载、哈希未校验、未验证即完成均一票否决。

## Resource 边界

不迁移 Resource Runner 到新 Execution Runtime。Resource 继续使用原实现；只允许未来单独计划后复用 Adapter。

## 完成条件

- 所有副作用都经过明确权限、Sandbox 和可审计 Approval。
- 长进程在断线、取消和 Host shutdown 后有唯一确定状态。
- 受管依赖可以在没有系统包管理器时从固定 Artifact 安装。
- PDF 真实场景达到 90/100，且无安全硬否决。
- 旧 `run_command` 调用方兼容，Resource 回归测试无变化。

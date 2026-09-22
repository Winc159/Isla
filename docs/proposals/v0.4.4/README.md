# v0.4.4：Controlled Shell and Execution World

状态：设计完成，等待 v0.4.3

## 目标

为真实个人自动化增加第一个通用执行能力：受控、可取消、可审计的非交互 Shell，并把文件与进程操作绑定到同一 workspace 和权限策略。

## 范围

- argv 数组执行，不接受模型提供的 shell command string。
- workspace cwd、环境变量白名单、输出/时间/进程树限制。
- read-only、workspace-write、full 三档策略与 Approval。
- 统一 AbortSignal 和子进程收敛。
- Windows、Linux、macOS Adapter 契约；当前平台真实验收。

## 非目标

不做持久 PTY、交互式终端、容器编排、远程 sandbox、sudo、后台 Job、包管理器自动安装或任意宿主凭据继承。

文档入口：[设计](design.md) · [实施](implementation.md) · [测试](testing.md) · [验收](evaluation.md)

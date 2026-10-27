# v0.7.2 通用执行闭环阶段评分

本评分仅覆盖 v0.7.2 的 Policy/Approval、执行进程生命周期和运行环境事实，不代表整版完成。整版仍须完成计划中未完成的 Sandbox Adapter、PTY、网络策略/下载、受管依赖和兼容迁移。

阶段及格线：90/100；跨 Session 访问、越过 Workspace 工作目录边界或未经批准执行命令均为一票否决。

| 项目 | 分值 | 验收证据 | 状态 |
|---|---:|---|---|
| 持久 Approval 规则可查看、添加、撤销，并精确匹配权限、工具、Workspace、argv 与过期时间 | 20 | `tests/approval/policy.test.ts`、`tests/cli/approval-command.test.ts` | 通过 |
| 冲突规则显式 deny 优先，未匹配时遵循当前交互策略 | 10 | Policy Evaluator 与 ToolRuntime 自动测试 | 通过 |
| 进程启动、有限 stdin、状态和可恢复终态 | 15 | `tests/tools/process-registry.test.ts` | 通过 |
| Cursor 输出有界、可持续读取，保留 UTF-8 多字节字符 | 15 | 大输出及拆分 UTF-8 自动测试 | 通过 |
| 超时、主动取消、Session/Host 关闭收敛；Session 间隔离 | 15 | Process Registry 与 Application 自动测试 | 通过 |
| 拒绝 Workspace 外部目录及经由 symlink/junction 逃逸 | 10 | Windows junction/越界自动测试 | 通过 |
| 环境摘要与命令可用性检查不泄漏 PATH 原文 | 5 | `tests/tools/execution-runtime.test.ts` | 通过 |
| 真实 BAILIAN 对话完成环境检查、启动、读输出、核对退出状态，无审批绕过 | 10 | `validation/run-policy-dialogue.mjs` | 通过 |
| **合计** | **100** | **阶段门槛 90** | **100/100** |

整库验证：168 个测试文件通过、7 个文件跳过；665 个测试通过、13 个测试跳过；TypeScript 类型检查、Runtime 构建和 Resource UI 构建均通过。

真实对话：BAILIAN 实际按顺序调用 `exec_environment`、`exec_start`、`exec_read`、`exec_status`；`exec_start` 触发 `approval_request`，协议客户端显式单次批准；报告 Node.js `v24.22.1`、状态 `exited`、退出码 `0`；验证脚本及 Isla 进程均以退出码 `0` 结束。

**阶段通过，但 v0.7.2 整版未通过/未完成，不得据此进入下一版本或宣称整版验收通过。**

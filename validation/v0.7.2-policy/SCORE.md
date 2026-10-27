# v0.7.2 权限策略基础层阶段评分

本表只评估当前已实施的策略基础层，不代表 v0.7.2 整版完成。整版提交门槛仍要求计划中的长进程、跨平台执行器、网络策略和其余执行生命周期能力完成。

本阶段及格线：90/100。

| 项目 | 得分 | 证据 |
|---|---:|---|
| 规则按权限、工具、工作区、argv 前缀和过期时间匹配 | 25/25 | `tests/approval/policy.test.ts` |
| 持久化规则添加、替换、读取和撤销 | 20/20 | `tests/approval/policy.test.ts` |
| ToolRuntime 对精确 allow/deny 规则强制执行 | 25/25 | `tests/core/tool-runtime.test.ts` |
| Isla CLI 可添加精确规则、查看和撤销 | 15/15 | `tests/cli/approval-command.test.ts`、`tests/cli/commands.test.ts` |
| 真实对话经过远程单次审批后调用命令 | 15/15 | BAILIAN 实际收到 `exec_start` 的 `approval_request`，NDJSON 客户端发送单次允许响应；随后真实 `exec_read` 与 `exec_status` 核实版本和退出码 0 |
| **阶段总分** | **100/100** | **阶段通过，整版未完成** |

全量验证：168 个测试文件通过、665 个测试通过、7 个文件和 13 个测试跳过；TypeScript 类型检查、Runtime 与 Resource UI 构建通过。

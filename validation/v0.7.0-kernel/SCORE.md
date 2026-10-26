# v0.7.0 Runtime Kernel 验收评分

及格线：90/100；任一硬性失败（无法启动、无法收敛、资源边界回归）直接不通过。

| 项目 | 得分 | 证据 |
|---|---:|---|
| 服务注册、依赖排序、缺失/循环检测与回滚 | 25/25 | `tests/core/service-kernel.test.ts` |
| RuntimeScope、AgentRegistry、会话生命周期 | 25/25 | `tests/core/service-kernel.test.ts`、`tests/core/session.test.ts`、`tests/application.test.ts` |
| Host/CLI/NDJSON 关闭与唯一收敛 | 20/20 | `tests/host.test.ts`、`tests/protocol.e2e.test.ts`；真实对话进程 exitCode=0 |
| 既有能力兼容性 | 20/20 | 全量验证：163 个文件、642 个测试通过，7 个文件/13 个测试跳过 |
| Resource 边界未被 Runtime Kernel 侵入 | 10/10 | 全量 Resource 测试与 UI 构建通过；未修改 Resource 服务事实源 |
| **总分** | **100/100** | **通过** |

真实对话：`validation/run-kernel-dialogue.mjs` 使用 BAILIAN 配置启动最新构建，收到非空 `response_end`（268 字符），随后正常关闭，进程退出码为 0。

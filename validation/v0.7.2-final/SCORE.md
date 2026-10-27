# v0.7.2 整版验收评分

验收日期：2026-10-27。严格及格线：90/100；未经批准执行、跨 Session 访问、Workspace 路径逃逸或虚报未经验证的结果均一票否决。

| 维度 | 得分 | 证据与判断 |
|---|---:|---|
| Policy、权限类型与 Approval 生命周期 | 20/20 | 精确权限/Workspace/argv/host 规则、deny 优先、撤销及多权限安装审批；相关 Policy、CLI 和 ToolRuntime 自动测试通过。 |
| 长进程与跨平台执行接口 | 18/20 | Session 隔离、Host/Session 清理、cursor/stdin/PTY、终态/超时/取消和执行统计通过自动测试；当前机器真实运行验证为 Windows，其余平台由契约测试覆盖，未宣称做过真实主机验证。 |
| 网络目标与安全下载边界 | 15/15 | 公网 DNS/IP 固定传输、精确 host Approval、拒绝 redirect、响应/下载字节限制、哈希校验及失败清理测试通过。 |
| 固定 Manifest 受管依赖 | 14/15 | Agent 仅提交 dependency ID/版本；Profile 固定 HTTPS、SHA-256、平台/架构、执行文件及版本探针；幂等安装、Registry、Managed Toolchain、卸载和双重审批测试通过。默认 Profile 不预装未经核验的第三方清单，真实第三方下载未在本次对话中执行。 |
| `run_command` 兼容与 Resource 隔离 | 10/10 | argv 调用走 Execution Process Registry，旧字符串路径保留；完整 Resource 测试与 Resource UI 构建通过，Resource 服务代码未迁移。 |
| 真实 BAILIAN 执行闭环 | 10/10 | `validation/run-policy-dialogue.mjs` 的真实对话依次完成环境检查、审批请求、单次批准、进程启动、cursor 输出和状态核验；报告 Node.js v24.22.1、exited、exitCode 0。所有阶段断言为 true。 |
| 文档、配置与范围边界 | 5/5 | Profile 配置、Local 与 Container 隔离差异、默认空 Manifest 行为、Resource 边界和不含 PDF 专项工具已写明。 |
| **总分** | **92/100** | **通过（≥90），无一票否决项。** |

## 自动验收

`node scripts/verify.mjs`：172 个测试文件通过、7 个跳过；691 项测试通过、13 项跳过；TypeScript 类型检查、Runtime 构建和 Resource UI 构建全部通过。`git diff --check` 无空白错误。

## 安全边界说明

Local Adapter 是经 Approval 保护的直接执行器，不提供 OS 级文件隔离。需要隔离执行时，必须配置 digest 固定的 Container Adapter；其禁网、只读 rootfs、资源限额，且只挂载当前 Workspace。默认 Profile 的依赖清单为空；管理员需自行配置并审核固定 Artifact Manifest。Resource Runner 未接入该执行链。

# v0.8.1.0 当前评估能力矩阵

以实现和契约测试为依据；这里的 `implemented` 只说明代码能力存在，不等价于跨平台或真实模型场景已验收。

| 能力 | 状态 | 证据 | 失败策略 |
| --- | --- | --- | --- |
| Session/Provider 对话及失败保留用户输入 | implemented | `tests/core/session.test.ts` | Provider 错误安全失败；有效回答才入历史 |
| Tool loop、拒绝审批后停止 | implemented | `tests/core/session.test.ts` | 拒绝即停止当前副作用链 |
| Plan/Act 证据完成门禁 | implemented | `tests/core/session.test.ts`, `tests/core/completion-gate.test.ts` | 缺证据不完成，回退/阻止提交 |
| Workspace 越界防护 | implemented | `tests/sandbox.test.ts` | 拒绝路径逃逸、受保护路径和 symlink 逃逸 |
| Host Turn 断线事件回放 | implemented | `tests/host.test.ts` | 保持 Turn，按事件游标恢复观察 |
| Host Provider 失败终态 | implemented | `tests/host.test.ts` | 安全错误码和唯一失败终态 |
| Resource Bridge 窄接口 | implemented | `tests/resource/bridge-client.test.ts` | 非法路径/操作在发请求前拒绝；Resource 服务不变 |
| MCP stdio 对已安装 Server 的互操作 | partial | `tests/smoke/mcp-interoperability.test.ts` | 仅显式配置和本地 server；故障应撤下工具并关闭进程 |
| Web UI 与 Host 真实浏览器端到端 | partial | `tests/web/`、`agent-ui/` | 自动 UI/构建测试存在；v0.8.0 CLI→Web 人工验收仍待用户 |
| 跨平台 CI（Windows/macOS/Linux） | implemented | `.github/workflows/ci.yml` | 每个平台独立 check/build/package；不代表 macOS ARM64 真机 |
| PDF/Office、MCP HTTP/OAuth、通用 Job/Subagent、远程 steer | not implemented / not in scope | 路线图 v0.8.2+ | 不创建成功假设或假 Fixture，待对应版本能力落地 |
| 真实任务的模型质量（coding/research/approval） | not evaluated | v0.8.1.0 opt-in 真实评测步骤 | 额度/费用确认后由人工评分；未执行不得声称通过 |

## 离线 Fixture

JSON Fixture 固定测试文件和测试标题；Runner 不接受任意命令、路径或 Provider 配置。它运行的是离线契约回归，不能代替真实 Agent 任务评分。新增能力时，在对应功能代码和测试存在后再添加 Fixture。

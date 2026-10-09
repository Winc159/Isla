# Isla 当前测试与发布验证

测试目标是验证 Runtime 契约，同时避免默认产生网络请求、费用或私人日志。

## 测试分层

| 层级 | 入口与范围 | 默认/CI |
|---|---|---|
| 单元测试 | `tests/core/`、`tests/tools/`、`tests/memory/` 等，验证纯状态、解析、策略和适配器 | 是 |
| Runtime 集成测试 | `tests/application.test.ts`、`tests/core/runtime.test.ts`、Session/Tool/Capability 测试 | 是 |
| Protocol 测试 | `tests/protocol*.test.ts`、`tests/protocol-*.e2e.test.ts` | 是 |
| MCP smoke | `tests/smoke/mcp-interoperability.test.ts`；`npm run test:smoke:mcp` 使用本地 fixture/进程 | 测试文件默认可运行；专项命令按需 |
| Browser/PTY | Browser mock/适配器测试默认运行；真实 PTY 用 `npm run test:pty`，依赖可选 `node-pty` 和本机工具链 | Browser 离线测试是；真实 PTY 否 |
| 真实 Provider | `test:smoke:real`、`test:smoke:real:ndjson`，需要显式开关、网络、Profile/环境和费用授权 | 否 |
| 本地真实评估 | `.isla-local/evaluation-scripts/` 与 `.isla-local/evaluations/` | 否，且不得入 Git |
| 发布前检查 | `verify`、`pack:check`、Markdown/安全/版本检查 | 是或发布前手工执行 |

## 标准命令

```bash
npm run verify
npm run check
npm run pack:check
git diff --check
```

- `npm run verify`：依次执行 TypeScript 类型检查、完整 Vitest 离线套件和构建。
- `npm run check`：执行 `typecheck` 和 `test`，不单独构建。
- `npm run pack:check`：执行 `npm pack --dry-run`，核对发布白名单；当前包只应包含 `dist`、`README.md`、`LICENSE` 和 npm 元数据。
- `git diff --check`：检查空白错误，不改变 Git 状态。

CI 在 Node.js 24 上对 Ubuntu、Windows 和 macOS 执行 `npm ci`、`npm run check`、`npm run build` 和 `npm run pack:check`。

## 真实网络与本机依赖

真实 Provider 测试必须由 `ISLA_RUN_REAL_SMOKE=1` 等显式开关启用，并使用隔离配置。MCP 第三方 Server、Playwright 浏览器安装、真实 PTY、Linux systemd/macOS launchd 和跨机部署都依赖本机环境，不能用 Windows 离线测试代替。

未设置开关而被跳过的真实测试只能记录为“未执行”或“跳过”，不能写成通过。真实网络结果也不能替代确定性的 fixture 与单元测试。

## 评估与日志边界

- 原始 Provider 响应、聊天 transcript、JSON/NDJSON、账号信息和凭据只能写入 `.isla-local/evaluations/`。
- 版本专项脚本放入 `.isla-local/evaluation-scripts/`，不进入正式 `scripts/`。
- 仓库只保留脱敏后的场景、命令、判定、统计和必要的失败原因。
- HTTP 非 2xx、空 Provider 内容或仅有搜索摘要不能冒充成功的外部读取证据。
- 文档测试不得在默认测试期间改写正式验收记录。

## 文档与安全验证

文档版本至少检查：

1. Markdown 相对链接和引用的源码路径存在；
2. 文档提到的 npm script 可在 `package.json` 找到；
3. README、package 和 proposal 的版本一致；
4. 不再引用已删除的版本专项脚本；
5. Markdown 链接不含本机绝对路径；
6. `docs/` 不含原始云端 JSON/NDJSON 或未脱敏 transcript；
7. 不含 API Key、Token、密码和真实凭据。

安全扫描中的示例变量名、占位符和设计说明不是凭据；发现疑似秘密时必须人工核对，不能把扫描无命中当作绝对证明。

## v0.4.8 关键回归面

- Catalog manifest 校验、稳定 ID、检索、availability 和 policy；
- Task 激活持久化、重复激活与新任务重置；
- 每步 Snapshot 的工具集合、hash、预算和下一步生效语义；
- Prompt Injection 不激活非只读能力；
- MCP allow/deny、工具名映射、崩溃撤下与关闭；
- Browser URL Policy、人工接管和凭据不泄漏；
- 外部研究完成门禁与 HTTP 非 2xx 证据拒绝；
- Session、Context、Journal、Memory、NDJSON 和取消回归。

## 发布门禁

发布前应完成离线验证、文档/安全检查和目标平台安装验收；只有相应能力确实执行过才记录“通过”。最终调整版本号后，应重新运行版本一致性、构建和 `pack:check`。

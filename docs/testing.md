# Isla 当前测试与发布验证

测试目标是验证 Runtime 契约，同时避免默认产生网络请求、费用或私人日志。

## 测试规模与归档规则

测试文件按被测边界组织，而不是按版本复制：`core/`、`resource/`、`tools/`、`providers/`、`protocol/`、`pty/` 和 `smoke/` 分别覆盖对应领域。新增功能优先补充现有领域测试；只有出现新的运行边界时才新增目录。

版本号目录（例如 `tests/v0.5.3/`）只允许保留仍然代表当前公开契约的回归测试。一次性版本验收、真实 Provider transcript、截图和大文件材料放入被 Git 忽略的本地归档，不进入 `tests/`。

测试分为三层：默认测试（无网络、无真实凭据）、验收测试（跨进程、PTY、Host/Resource 和 MCP 边界）以及真实测试（Provider、浏览器、外部下载）。真实测试必须显式开启，不属于默认门禁。

测试数量增加本身不是问题；重复测试、不可重复的真实材料和按版本复制的脚本才是维护成本。定期删除已被当前契约覆盖、且没有独立回归价值的旧测试。

## 测试分层

| 层级 | 入口与范围 | 默认/CI |
|---|---|---|
| 单元测试 | `tests/core/`、`tests/tools/`、`tests/memory/` 等，验证纯状态、解析、策略和适配器 | 是 |
| Runtime 集成测试 | `tests/application.test.ts`、`tests/core/runtime.test.ts`、Session/Tool/Capability 测试 | 是 |
| Protocol 测试 | `tests/protocol*.test.ts`、`tests/protocol-*.e2e.test.ts` | 是 |
| MCP smoke | `tests/smoke/mcp-interoperability.test.ts`；`npm run test:smoke:mcp` 使用本地 fixture/进程 | 测试文件默认可运行；专项命令按需 |
| Browser/PTY | Browser mock/适配器测试默认运行；真实 PTY 用 `npm run test:pty`，依赖可选 `node-pty` 和本机工具链 | Browser 离线测试是；真实 PTY 否 |
| Resource 子系统 | `tests/resource/`，覆盖契约、SQLite schema、Scheduler、百度下载、归档、HTTP API、Web 工具台后端和 mock E2E | 是 |
| Resource Worker | Config/Profile、Host structured inference、HTTP client、三类 schema、调用条件、失败降级和命名兜底 | 是 |
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

## 主 Agent Runtime 关键回归面

- Catalog manifest 校验、稳定 ID、检索、availability 和 policy；
- Task 激活持久化、重复激活与新任务重置；
- 每步 Snapshot 的工具集合、hash、预算和下一步生效语义；
- Prompt Injection 不激活非只读能力；
- MCP allow/deny、工具名映射、崩溃撤下与关闭；
- Browser URL Policy、人工接管和凭据不泄漏；
- 外部研究完成门禁与 HTTP 非 2xx 证据拒绝；
- Session、Context、Journal、Memory、NDJSON 和取消回归。

## v0.5.0 Resource 关键回归面

- Resource 配置、受管目录、loopback/认证和公开配置投影；
- SQLite Job/Event/Secret/Lease schema、重启恢复、取消、重试和清理语义；
- 下载、检查、解压、发布的分池并发和同一 Job 状态迁移；
- 百度网盘目录浏览、批量建 Job、下载 runner 和稳定错误分类；
- 普通密码归档、候选密码、改后缀、分卷、RAR5、输出校验和空包装目录整理；
- 文件夹 watch、稳定观察、账本去重和受管根路径边界；
- Resource Web 工具台只操作 Resource API，不承担主 Agent 对话。

## v0.5.1 Worker 关键回归面

- Config 中 primary Profile 与 `workerProfile` 独立选择、装配和模型快照；
- Resident Host `POST /api/v1/inference/structured` 的认证、取消、安全错误和未配置角色行为；
- `parse-share-text`、`identify-content`、`suggest-title` 的 task/schema 对应、输入上限和输出校验；
- 规则充分时零 Worker 调用，规则不足时通过 inference pool 发起一次有界请求；
- Worker 结果不覆盖已验证事实，非法路径或标题被拒绝，需要时进入人工确认；
- Worker 未配置、不可达、超时、取消或返回非法内容时保留规则/人工/日期兜底；
- Worker 不获得 Session、Memory、Tool、Capability、文件系统权限或多轮循环。

已完成的本地真实验收材料保存在被 Git 忽略的 `.isla-local/evaluations/v0.5.1/`。最近一次闭环覆盖百度网盘测试归档下载、Worker 命名判断、无可靠标题时日期兜底、解压与输出校验；Job 到达 `completed`，输出文件 SHA256 与原始测试文件一致。该记录只证明已执行的本地链路，不替代跨平台发布门禁。

## 发布门禁

发布前应完成离线验证、文档/安全检查和目标平台安装验收；只有相应能力确实执行过才记录“通过”。最终调整版本号后，应重新运行版本一致性、构建和 `pack:check`。

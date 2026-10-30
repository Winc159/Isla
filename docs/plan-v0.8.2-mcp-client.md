---
id: "mcp-client-v082"
title: "v0.8.2 MCP Client"
created: "2026-10-29"
updated: "2026-10-30"
planVersion: 1
status: complete
modules: [mcp, host, config, user-questions]
summary: "将现有 stdio tools adapter 扩展为可安全使用的完整 MCP Client。"
predecessors: ["v0.8.1.0"]
supersedes: []
---

# Isla v0.8.2：完整 MCP Client

## 基本信息

- 仓库：existing；`Winc159/Isla`。
- 分支：`main`。
- 项目相对位置：`docs/plan-v0.8.2-mcp-client.md`。
- 设计基线：`92c9286 feat: add v0.8.1.0 quality and lifecycle gates`。
- 需求来源：路线图 v0.8.2“完整 MCP Client”；用户要求进入下一阶段并自主修复验收问题。
- 方案状态：版本范围已收口；本文档是实现、验收证据和明确延期项的事实源。
- 路径说明：v0.8.2 MCP 计划使用显式文件名 `docs/plan-v0.8.2-mcp-client.md`。原名 `docs/plan-v0.8.2.md` 的正文实际是 v0.8.3 计划，现已规范为 `docs/plan-v0.8.3.md`；内容保留不变。

## 历史依据与本次决策

- `docs/roadmap.md`：v0.8.2 是完整 MCP Client；中期能力列有 HTTP/OAuth/resources/prompts/elicitation/热重载。
- `docs/architecture.md` § MCP 与 Browser 边界：当前只支持 Profile 配置的本地 stdio 工具；远程传输、OAuth、resources、prompts、热重载未实现。
- `src/mcp/stdio-client.ts`、`host.ts`、`catalog.ts`、`tool.ts`：现有实现已采用官方 TypeScript SDK，支持 stdio tools discovery/call、受限目录映射、结果大小限制、可选 Server 故障降级与 Profile allow/deny。
- `src/mcp/profile-schema.ts`、`profile-config.ts`：当前 Profile 只允许 stdio command/args/cwd/env；Host 启动时固定连接。
- `src/user-questions/types.ts`、`protocol/questions.ts`、`host/server.ts`：已有可用于 MCP Form Elicitation 的本地/远程用户提问链路，但尚未与 MCP Client 连接。
- [MCP 2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28)：采用当前稳定协议。现代协议通过 Streamable HTTP 和 stateless requests 运作，服务器需要额外用户输入时由 Multi-Round-Trip Requests 表达；Roots、Sampling、Logging 已弃用或移除，不向 MCP Server 声明这几项能力。
- [Official TypeScript SDK client guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/clients/connect.md)：继续使用官方 SDK 管理协议握手、传输、工具/资源/Prompt 请求，不自研 JSON-RPC、OAuth 或 SSE parser。支持 stdio 和 Streamable HTTP；不额外承诺已弃用 SSE-only 服务器。
- [Official SDK OAuth guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/clients/oauth.md)：授权发现、OAuth callback/issuer 检查、PKCE 和 token refresh 由 SDK 执行；Isla 提供受控的用户交互和凭证存储，不实现 OAuth wire protocol。
- [官方安全公告 GHSA-6prh-2h8m-c8cw](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6prh-2h8m-c8cw)：`@modelcontextprotocol/client` 2.0.0–2.2.x 的 HTTP/OAuth 请求会在跨源重定向时泄露自定义凭证或请求体；实现远程传输前必须升级到已修复的 2.3.0 或更新兼容版本，并回归跨源重定向不泄漏。
- [DSH MCP package](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/mcp) 与现有 `docs/references.md` 记录：沿用多 Server 生命周期隔离、限定工具名、目录原子替换和外部结果不可信；不复制 Cordis 层或源码。

### 采用、暂缓、拒绝

- **采用**：官方 MCP TypeScript SDK；stdio + Streamable HTTP；现代协议协商；MCP Tools、Resources/Resource Templates、Prompts；Form Elicitation 通过现有 UserQuestionService；`tools/list_changed`、`resources/list_changed`、`prompts/list_changed` 触发有界目录刷新；OAuth 由 SDK 负责协议逻辑，token 按 Isla 私有 Config/Profile 权限保护且绝不进入 Session/日志/工具结果。
- **保留兼容**：既有 stdio Profile 不迁移；已存配置继续按 stdio 解释；MCP 服务器新增/更新仅在显式配置保存后并在 Host 下次启动生效，v0.8.2 不热替换活动 Client，避免活动 Tool Call 与目录 generation 竞态。
- **暂缓**：运行期热重载、OAuth 管理型远程 UI、MCP Tasks extension、server sampling、roots、logging、URL-mode elicitation 和 SSE-only legacy transport。现代协议不要求 Roots/Sampling/Logging，Roots 不作为 Isla Sandbox 授权；URL elicitation 需设计可信 URL 展示与人工确认界面后另行评估。
- **拒绝**：自写 MCP JSON-RPC/HTTP/OAuth、自动安装 MCP Server、信任服务器提供的 description/instructions、把 MCP 结果写入 Isla system prompt、把远端 URL 当成网络策略豁免、允许 Server 扩大工作区或执行权限。

## 方案深度

### Context

当前 Isla 有可用但局限的 stdio tools adapter：Profile 声明一个本地子进程，McpHost 启动后调用 `tools/list`，把工具映射为现有 `ToolCapability`，再由 Agent Loop 经 Capability/Policy/Approval/Sandbox 调用。此路径不支持 HTTP Server、OAuth、Resources、Prompts、Elicitation 或目录变更通知。现有 SDK 版本为 2.0.0；它低于官方 HTTP redirect credential disclosure 修复版本，不能直接用于新 HTTP 功能。

### Container

```text
Profile MCP config -> MCP Host -> MCP Client (official SDK)
                                ├─ stdio transport
                                └─ Streamable HTTP transport + OAuth
                                     ├─ Tools -> existing Tool Runtime / Policy / Approval
                                     ├─ Resources -> bounded read/list MCP capability tools
                                     ├─ Prompts -> bounded list/get MCP capability tools
                                     └─ Form Elicitation -> existing UserQuestionService
```

Resource Service 与 Resource SQLite/Scheduler/Worker 不变；MCP 仅是主 Agent 的外部协议连接层。

### Component

- `McpClient` 抽象在 transport 之后提供 connect/status、tools/resources/prompts list/read/get、elicitation handler、close；实现依赖官方 SDK。
- `McpHost` 按 server 独立连接和故障隔离。required Server 启动失败仍按现有语义让启动失败；optional Server 仅投影安全错误码并保持 Agent 可用。
- 每个 Server 的能力 generation 原子替换。单一 `list_changed` 通知只触发对应 Server 的刷新；刷新失败时撤下过期 generation，禁止继续调用陈旧目录项。
- MCP Tools/Resources/Prompts 均作为不可信外部输入，经有界 schema、结果大小限制和普通 Runtime 权限链；Resources/Prompts 只有 Server 真正声明且列举成功才暴露对应能力工具。
- Elicitation handler 校验 schema 类型、字段数、大小和可表达性，将 Form 请求转换为现有用户问题；accept 数据必须做 JSON Schema 校验，decline/cancel 按 MCP 动作返回。任何没有交互式 UserQuestionService 的 Host 均 fail closed，不伪造用户同意。
- Profile 配置要求显式 transport/endpoint/auth；HTTP 默认 HTTPS，只允许 loopback 使用 HTTP；不从任意网页内容动态创建 MCP Server。
- OAuth refresh/access token 仅由私有 ConfigStore 保存；状态/诊断只返回 Server ID、transport、功能计数和稳定错误码，不返回 URL 中的敏感查询参数、Authorization、token、PKCE verifier 或 stderr 原文。

### Code / 实施步骤

1. **方案与现状基线**：完成本计划；提取 MCP 当前测试基线、Node 24 和现有跨平台 CI 触发结果；确认 Resource 零改动。
2. **依赖安全基线与客户端接口**：升级官方 MCP Client/Server SDK 到包含跨源重定向修复的兼容版本；保持 lockfile 可复现。提取最小 transport-neutral `McpClient` 接口，stdio 全部既有用例通过。
3. **Transport 与 Profile**：扩展 Profile parser/config command 支持 stdio、Streamable HTTP URL 与显式认证配置；为 endpoint 实施 HTTPS/loopback 校验；保持旧 stdio 配置兼容。连接/关闭/超时/取消/optional-required 故障都有确定结果。
4. **OAuth 与密钥边界**：用官方 SDK 实现 OAuth discovery/PKCE/token refresh；将用户授权 URL、callback 和取消接入现有 Approval/UserQuestion 边界；保存 OAuth 状态到用户私有配置。用 mock authorization server 验证 issuer/state、refresh、拒绝、取消与敏感字段不外泄；禁止跨源重定向发送凭据。
5. **MCP 协议面**：接入 Tools、Resources/Resource Templates 与 Prompts 的 list/read/get；将每类能力映射成窄而有界的 Agent tools；支持对应 `list_changed` 通知的 generation 刷新。外部 instruction/result 作为不可信数据，不并入 system prompt。
6. **Elicitation**：将 SDK 的 Form Elicitation handler 接到当前 Turn 的 UserQuestionService；本地 CLI、NDJSON、Resident Host/Web 远程 question 都能等待用户答复；无交互服务、非法 schema、用户拒绝/取消时 fail closed。
7. **生命周期与状态**：扩展 `mcp/status` 安全投影；多 Server 独立初始化/退出/崩溃恢复语义明确；配置保存后提示需重启 Host，不实现活动连接热重载。
8. **验收与真实任务**：跑全量 Node 24 `verify`、`pack:check`、MCP fixtures 和官方独立 MCP Server interop；使用真实 Provider 对合成 MCP Server 完成一次复合任务（发现工具、读取 resource、使用 prompt 或 Elicitation，核对结果）；评分至少 90/100，无安全硬否决。可用 CI 平台验证 Windows/Linux/macOS，不把无设备的 macOS ARM64 端到端记为通过。

## 风险与待确认项

- MCP 2026-07-28 与早期 2025-era 有生命周期差异；协议协商必须交给 SDK，fixture 至少覆盖当前现代协议与一个仍需支持的旧 stdio Server。
- OAuth 账户信息与长寿命 Token 属敏感数据；任何持久化、诊断或 Web API 投影不得返回凭证。若无法在当前 ConfigStore 模式下满足私有文件权限和 token 最小化，不允许启用 OAuth 登录态持久化。
- MCP Resource 内容和 Prompt 文本可能包含 prompt injection；必须保留数据/指令区分，外部文本不能获得系统/开发者消息优先级。
- 远端 Server 是用户显式配置的网络连接，不是 SSRF 任意入口；Redirect、DNS/私网地址与重绑定边界需由 SDK/Isla endpoint policy 明确验证。
- 当前 CLI/Web 远程 UserQuestion 能否表达 MCP Elicitation 所有 JSON Schema 字段，需先核实。不可表达字段必须在调用 Server 前拒绝或让用户明确选择，不得丢字段后自动提交。
- 不改 `src/resource/**`、Resource schema、HTTP API、Scheduler、SQLite 或 Worker。

## 测试与验收目标

### 自动验收

- 全量 `node scripts/verify.mjs` 通过；`pack:check` 保持包 allowlist，MCP config/token/OAuth 和本地 event artifacts 不进入 npm 包。
- Profile 迁移：无 MCP、stdio v0.8.1 配置继续读取；非法 transport、URL、auth、重复 ID 和越界限制被拒绝；保存其他 Profile 不变。
- 协议兼容：标准本地 stdio Server 和 Streamable HTTP mock Server 的 initialize/discovery、tools/list/call、resources/list/templates/read、prompts/list/get 均通过；测试不依赖公网。
- 安全：跨源 30x 不携带 Authorization/custom headers/body；非 HTTPS 远端 URL 被拒绝；敏感 query、token、OAuth code/state/verifier、stderr 不进入 Session、Journal、日志、状态协议、公开报告和 npm 包。
- Approval：MCP tool 的高风险/写入行为与普通 Tool 一样要求 Approval；拒绝后无副作用；Server 返回的指令不能改变 Policy、Sandbox 或模型能力。
- Elicitation：有效表单 accept 经过 schema 验证；decline/cancel、无 UserQuestionService、超时、异常 schema 均不回退成默认接受；被取消 Turn 唯一收敛。
- generation：三个 list_changed 方法仅刷新对应 Server 的对应目录；刷新失败不保留陈旧写入工具或陈旧描述；一个 Server 崩溃不撤下其他 Server。
- 容量/取消：Server、工具、schema、结果和分页均有上限；工具调用 AbortSignal 可到达 stdio/HTTP 请求；Host close 完成所有 Client 清理，无孤儿子进程。
- 独立 Interop：不依赖 Isla 自制 MCP Server 的同包客户端/服务端互测作为唯一证据；使用官方 SDK sample 或独立开源 MCP Server。

### 真实任务严格门槛

固定合成 Server 与任务，例如“发现汇率工具，读取该 Server 的一条资源，按 Prompt 参数格式执行计算，并在缺少目的地时通过 Elicitation 询问”，每轮新建隔离 Session/Server，不使用私有数据或对公网副作用。按 v0.8.1.0 rubric 评估目标达成、事实正确、验证、工具效率、安全/审批和最终说明；3 次中至少 2 次 ≥90，第三次无安全否决，所有确定性断言每次均通过。Provider 额度不足时记录资源耗尽，不记作功能通过/失败。

### 完成条件

- 上述步骤 1–8 均有可复现证据；安装/重启、配置旧版本兼容、取消和安全拒绝路径均通过。
- stdio 与 Streamable HTTP MCP 客户端可在 CLI、Resident Host 和 Web Agent Loop 中使用；工具、Resources、Prompts、Form Elicitation 都遵循现有能力与审批边界。
- 官方 SDK 版本已包含 HTTP redirect 修复；没有自写 MCP 协议/OAuth 实现；没有真实凭证进入 Git、日志、Session、构建或包内容。
- Resource 原服务无改动。
- 真实任务达到严格评分线；本机与 CI 平台证据分别记录。没有真实 macOS ARM64 设备时，明确标记为未做原生 ARM64 端到端验收。

## 实施差异与验证记录

- 2026-10-30：完成步骤 1–3 的可验证子集。官方 Client/Server SDK 锁定到 2.3.0；新增 transport-neutral `McpClient` 接口并保留旧 stdio 配置；Profile 接受 HTTPS/loopback HTTP Streamable HTTP endpoint；HTTP redirect 使用 SDK `same-origin` 策略；stdio 与 HTTP 均通过 SDK 提供 Tools、Resources、Resource Templates、Prompts list/get/read 并映射到受限 Capability。修改 `src/mcp/{types,profile-schema,stdio-client,host,tool,diagnostics,profile-config}.ts` 与 `/mcp setup/config`。
- 2026-10-30：添加 stdio Server fixture 覆盖 resource/prompt 读取；添加官方 SDK `createMcpHandler` HTTP 互操作及 redirect regression tests。Node 24 `scripts/verify.mjs` 全通过（180 test files passed、7 skipped；756 tests passed、13 skipped；离线评估门禁 passed）。
- 2026-10-30：`scripts/pack-check.mjs` 因当前受限终端无法启动 `npm` 命令而未能完成；不是包清单通过证据。后续需在 npm 可调用环境重跑。
- 2026-10-30 追加：MCP Host 接入 SDK 的三个 list_changed handler，重新读取工具、资源/模板和 Prompt 后以单一 Host entry generation 原子替换；任一刷新失败时撤下该 Server 全部目录。辅助工具一并计入 128 总能力上限；资源、资源模板、Prompt 清单各限制 64 项。自动回归新增 Server 调用时禁用工具并验证 `tools/list_changed` 后目录撤下。
- 2026-10-30 追加：SDK Client 声明 Form Elicitation 能力，支持旧版 push Form 与 2026-07-28 `input_required` 自动多轮；只接受 16 字段内、64 KiB 内且 Isla UserQuestionService 可表达的表单，响应必需字段与 JSON Schema 由本地映射和 SDK 验证。工具、资源读取和 Prompt 获取使用同一 Server 的串行交互范围，当前回合的 AbortSignal 传到问题服务；不接受 URL 模式、复杂/未知 Schema、无交互 Host 或不完整必需回答。合成 stdio MCP Server 的完整 `input_required` → 用户答复 → 原调用续跑、并发回合隔离、取消传播及字段映射专项测试通过。
- 2026-10-30：Node 24 TypeScript 检查通过；MCP Host/stdio/Elicitation/HTTP/Profile 专项测试通过。Node 24 全量 `scripts/verify.mjs` 最终通过（182 test files passed、8 skipped；764 tests passed、14 skipped；offline evaluation gate 与 Resource/Agent UI 构建通过）。第一次全量运行遇到 `process-registry.test.ts` 输出时序失败，单测重跑通过，后续全量验证通过。
- 2026-10-30：先前一次真实 Provider 评测错误读取旧 `.env` 并选择 DeepSeek（HTTP 402）；该结果与当前 Config/Profile 无关，已作废。验证 Isla 默认 Profile 为 `bailian` / `qwen3.7-max-preview` 后，三轮复合任务实际发现并调用了 MCP 能力；暴露 Prompt 工具 JSON Schema 错误（已修正）及百炼偶发空回答。修正后的一轮完整任务为 100/100；三轮重测出现两次空回答，另一次 75/100，未达到三轮确定性断言和至少两次 90 分的验收线，不计通过。
- 2026-10-30：百炼 Provider 的带工具请求统一显式关闭 Qwen thinking；回归测试覆盖请求参数。`prompt_get` Schema 现在与执行参数 `{prompt, arguments}` 一致，并限制 Prompt 名称和参数字段；MCP Host 测试覆盖 Schema 与实际 Prompt 获取。百炼偶发空回答纳入既有最多一次的 recoverable retry；针对性 16 tests 及空回答恢复测试通过。
- 2026-10-30：曾有记录称默认 Profile `bailian` / `qwen3.7-max-preview` 三轮真实 Provider MCP 复合评测为 `100, 100, 100`；同日后续重测为 `100, 100, 75`，故该证据先标记为冲突并暂缓。用户将默认模型切换为 `qwen3.5-plus-2026-02-15` 后，使用真实百炼 Provider 对隔离合成 MCP Server 完整重跑三轮，结果 `100, 100, 100`；每轮均完成 6 项必需 MCP 工具调用、4 项结果逐字匹配、工具审批和 MCP Server 边界检查，满足真实任务验收线。该新结果解除真实 Provider 复合任务暂缓项。
- 2026-10-30：新增不依赖 MCP TypeScript SDK 的最小 JSON-RPC stdio peer，官方 SDK Client 与其完成握手、Tool、Resource、Prompt 交互。该结果补充协议级独立实现互通证据；外部开源 MCP Server 的端到端兼容性仍未验证。
- 2026-10-30：`scripts/pack-check.mjs` 实际执行失败，当前受限终端没有 `npm` 可执行文件（`npm is not recognized`），不能得出 package allowlist 验收结论；未尝试绕过系统 ACL。
- OAuth 设计已确认，实施仍未完成：本地 Host 使用仅绑定 loopback 的回调；远程 Resident Host 使用 Profile 显式配置的 HTTPS 公网回调地址，通过现有 Host 的授权流程把用户送到 OAuth 提供方，并让任意设备上的浏览器回调到 Resident Host。回调只接纳由 Host 发起且短时有效的 flow ID/state，SDK 负责 PKCE/code/issuer 校验；OAuth code/state 不进入 Session、日志或普通问题回答。若远程 HTTPS 回调地址未配置，远程 OAuth 必须 fail closed。长寿命 token 使用私有、权限受限的存储。
- 当前配置优先级已修复：普通 `dev`/`start` 不注入 `.env`，Config/Profile 缺失时不回退到环境变量，真实 Provider smoke 只读取默认 Profile；明确 `--env` 与 `dev:env` / `start:env` 保留作迁移入口。
- OAuth 后续进展：Host 的授权发起已由 bearer token 保护；本地 loopback 与显式远程 HTTPS callbackBaseUrl 均支持；回调仅匹配已配置 origin/path，成功/失败页面不反射 OAuth 参数。端到端验收发现 SDK 的 `finishAuth` 不负责比对 callback `state`，因此 Isla 在交给 SDK 前做常量时间 state 比对；SDK 执行 authorization-server issuer 检查、PKCE 和 token exchange。SDK 传输请求 token 时不提供 issuer context，Isla 只从该 MCP Server 隔离存储中经过 discovery 校验的 issuer 选取对应 access token。OAuth store 按 server/endpoint 哈希隔离，原子写入并尽量设置用户私有权限，损坏状态 fail-closed。自动测试覆盖权限位、损坏文件、verifier 清理、callback HTTPS 校验、授权 API 鉴权和 callback 来源校验。
- 2026-10-30：Node 24 `scripts/verify.mjs` 全量通过（184 test files passed、8 skipped；773 tests passed、14 skipped；offline evaluation gate、Resource UI 和 Agent UI builds passed）。OAuth/Host/Profile 专项测试 29 项、OAuth e2e 专项 6 项通过。切换到 Node `v24.20.0` / npm `11.19.0` 后，首次 `pack:check` 被默认 npm cache 目录 ACL 拒绝；将 npm cache 临时指向系统临时目录后，真实 `npm pack --dry-run --json` 通过（450 files），临时缓存已清理。官方开源 Filesystem Server `2.1.0` 外部互操作测试也通过。`git diff --check` 通过。
- 2026-10-30：本地独立 HTTP fixture 完成 MCP 受保护端点 + OAuth discovery/DCR/authorization-code/PKCE/token exchange 整条闭环。通过授权后 Host 连接成功并调用 `echo`；伪造 state 在 token endpoint 前被 Isla 拒绝，伪造 issuer 被 SDK 拒绝，用户拒绝返回 `access_denied` 且不会启用工具/换 token。针对性 OAuth 测试 6 项通过。
- 2026-10-30：使用未加入 Isla 依赖的官方开源 `@modelcontextprotocol/server-filesystem@2.1.0`，通过 npm 临时 cache 在隔离临时目录安装并由 MCP stdio Host 拉起；Host 发现 14 项工具并成功调用 `read_text_file` 读取合成 fixture，结果逐字核验。临时 cache、服务进程与数据目录均清理。它验证了真实第三方 MCP Server 互操作；Server 本身使用 MCP 官方 SDK，因此 SDK-free fixture 仍作为独立协议实现互通证据。
- **已收口的本地项目**：步骤 2–7 的实现；Node 24 全量验证（184 test files passed、8 skipped；773 tests passed、14 skipped；离线评估门禁及 Resource/Agent UI 构建通过）；`npm pack --dry-run --json`（450 files）；OAuth/MCP 本机闭环、错误 state/issuer/拒绝路径、官方开源 Filesystem Server 互操作；`git diff --check`。Resource Service 未修改。
- **后续部署/平台验收（不阻塞本版本收口）**：
  1. 远程公网 HTTPS OAuth + reverse-proxy TLS 部署端到端：本机 loopback/mock OAuth 及代理头/精确来源测试通过，但没有公网 TLS 部署实测；需要可访问的 HTTPS Host 与 MCP OAuth Server。
  2. Linux/macOS 远端 CI 与 macOS ARM64 原生端到端：CI 文件配置 Node 24 Ubuntu/Windows/macOS 矩阵，但本机 WSL 发行版查询遭系统拒绝访问，亦无 macOS ARM64 设备。
  3. 提交 `546d26dab0da111bdb8350173a9ea0a3101dda05` 已推送至 `origin/main`；CI 工作流配置为 push 触发，但当前可用查询只返回 PR 运行且没有报告，因此需在 GitHub Actions 页面确认本次 push 的 Ubuntu/Windows/macOS 结果。提交推送本身不代表 CI 通过。
- **收口结论**：v0.8.2 版本范围已完成并收口：本地实现、全量自动验收、真实 Provider MCP 复合任务、包检查和代码推送均有证据。公网 TLS 部署、CI 结果确认和 macOS ARM64 原生验证被登记为后续部署/平台验收，不再阻塞本版本功能收口；不得将缺失的平台结果描述为已通过。

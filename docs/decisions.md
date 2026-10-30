# Isla 当前架构决策

每项决策均记录背景、选择、代价和重新评估条件。历史设计过程见对应 proposal。

## D0 个人 Agent 的 Agent Turn 可观测性

- 背景：Agent Loop 的安全判断会随着 Tool、上下文、预算、取消和验证能力增加而增长。
- 决策：保留这些判断，但通过有限的 `TurnPhase`（preflight、model、executing_tools、observing、compacting、settling、completed、blocked、failed、cancelled）暴露当前阶段；观测回调不得影响回合执行。
- 选择：先增加明确状态和边界，再按真实复杂度拆分 TurnRunner、ToolPolicy 和 Settlement；暂不引入完整事件总线、通用 Agent Registry 或 DSH/Cordis 服务容器。
- 重新评估：当管理 CLI、Host API 或持久化日志需要消费同一套回合状态时，再把 Agent Turn 控制流从 `ChatSession` 提取为独立 Runner。

## D1 Config/Profile 是正常配置事实源

- 背景：Provider、模型、Base URL、凭据和能力策略需要可解释、可切换且不依赖 shell 状态。
- 决策：正常启动读取 `~/.isla/config.json` 或显式 `--config`；`.env` 只用于 `--env`、开发、CI 或迁移兼容。
- 理由：避免猜测环境变量含义，并让配置诊断与修改有唯一事实源。
- 代价：本地配置文件包含明文凭据，需要按私人文件保护；修改通常下次启动生效。
- 重新评估：引入系统凭据库或多用户配置服务时。

## D1a `.env` 必须显式启用

- 背景：开发启动、CLI 缺配置回退和真实 Provider smoke 曾各自隐式读取环境变量，导致实际 Provider/模型偏离默认 Profile，且同一问题反复出现。
- 决策：普通 `dev`、`start` 和真实 Provider smoke 不自动加载 `.env`；缺少 Config/Profile 时启动失败；只有 `--env` 或 `dev:env` / `start:env` 明确选择兼容模式时读取环境变量。真实 Provider smoke 只读取默认 Profile。
- 理由：把 Provider 与模型的选择锚定在唯一、可检查的配置来源，而不依赖 shell 的残留变量。
- 代价：首次运行或迁移中的用户必须显式完成 Profile 设置或选择兼容入口。
- 重新评估：若增加受管部署注入配置，则定义独立、可观测的配置来源契约；不得恢复隐式优先级。

## D2 Provider 表示协议而不是主机

- 背景：同一 OpenAI-compatible 协议可连接云端或局域网模型服务。
- 决策：Provider 负责请求/响应协议和能力声明；模型、IP、端口与 Base URL 属于 Profile。
- 理由：避免为每台主机或模型复制 Provider。
- 代价：模型族的细微差异需要窄能力策略或配置表达。
- 重新评估：目标服务无法由现有协议适配表达时。

## D3 部署方式不进入 Runtime Core

- 背景：Isla 需要在 Windows 开发机、macOS ARM64 和 Linux x64 上运行。
- 决策：Node、容器、systemd、launchd 和 Resident Host 都是托管/入口层，复用 Application 与 SessionFactory。
- 理由：保持核心可测试并避免设备绑定。
- 代价：平台安装和进程管理仍需独立验收。
- 重新评估：部署环境需要改变核心资源或安全模型时。

## D4 Session 必须重建实际模型输入

- 背景：调试、恢复和审计要求知道模型看到了什么。
- 决策：用户输入在 Provider 调用前进入历史；Context、Tool 结果、Task State 和请求快照可重建投影；只有有效回答进入 assistant 历史。
- 理由：失败、取消或空回答不能污染事实历史。
- 代价：Session schema、压缩与迁移更严格。
- 重新评估：引入不可重放的实时多模态输入时。

## D5 原始 Session 与模型 Context 分离

- 背景：长会话不能无限发送，但不可丢失事实。
- 决策：原始消息持久保存；预算压力只裁剪请求投影，并生成可追溯 checkpoint。
- 理由：兼顾可恢复性和上下文预算。
- 代价：投影、Journal 和 Token 估算增加复杂度。
- 重新评估：存储规模或隐私保留策略要求删除原始消息时。

## D6 Capability Catalog 由 Host 持有

- 背景：内建 Tool、Skill、MCP 和 Browser 需要统一发现，但不能把所有 schema 永久暴露给模型。
- 决策：Host/SessionFactory 构建 Catalog；Runtime 根据当前任务选择和激活能力。
- 理由：目录生命周期、Profile 和外部进程归属明确。
- 代价：入口必须共享同一装配路径，动态热重载暂不支持。
- 重新评估：出现跨 Host 分布式目录或可信在线插件系统时。

## D7 Tool Schema 按 Model Step 暴露

- 背景：静态大工具集增加 token 成本和误调用风险，模型又可能在执行中发现新需求。
- 决策：每个 Model Step 生成不可变 Snapshot；激活在下一步生效。
- 理由：工具集合可解释、可记录，并允许受控动态发现。
- 代价：能力激活通常多一次模型往返。
- 重新评估：Provider 支持等价且可审计的原生动态工具协议时。

## D8 激活不能绕过安全控制

- 背景：发现能力、允许模型看见 schema 和批准真实执行是不同权限。
- 决策：Capability availability 先受 Profile/Policy 限制；调用继续经过 Sandbox、Approval、MCP policy 和 Tool Runtime。网页不可信内容不能激活非只读能力。
- 理由：避免把路由层变成提权路径。
- 代价：同一能力会经过多层明确检查。
- 重新评估：只有在新的安全模型能给出至少同等隔离与审计时。

## D9 MCP 是外部能力协议，不是信任边界

- 背景：第三方 Server 的 schema、说明和结果可被污染或失控。
- 决策：首版仅支持 Profile 配置的本地 stdio Server；内容视为不可信，并受命名、预算、权限、取消和关闭约束。
- 理由：以最小协议面验证互操作，避免自动安装和远程授权复杂度。
- 代价：暂不支持远程 transport、OAuth、resources 和 prompts。
- 重新评估：出现必须使用远程 MCP 的真实需求并完成认证设计时。

## D10 Browser 保留人工控制与凭据隔离

- 背景：登录、验证码和敏感表单不能安全地完全交给模型。
- 决策：Browser Console 只监听 loopback；用户可接管；凭据由 Runtime 按精确 Origin 批准并填充，明文不进入模型上下文。
- 理由：把人类控制和秘密边界放在 Runtime，而非网页提示词中。
- 代价：无头主机需要端口转发和人工步骤。
- 重新评估：可信硬件凭据代理或更强隔离环境可用时。

## D11 原始真实评估日志不进入仓库

- 背景：真实日志可能包含账号、会话、查询、模型原文和凭据残片。
- 决策：原始材料写入 `.isla-local/evaluations/`，仓库只保留脱敏结论；专项脚本放 `.isla-local/evaluation-scripts/`。
- 理由：降低 `git add .`、npm 打包和公开仓库泄漏风险。
- 代价：公开证据不能逐字复现私人会话。
- 重新评估：建立经过审查、自动脱敏且可证明安全的公开数据集时。

## D12 运行期间不切换 Provider 或模型

- 背景：切换会改变能力、上下文限制、Session 恢复和错误语义。
- 决策：启动时固定 Provider 和模型；配置修改下次启动生效。
- 理由：保持单次运行的契约稳定。
- 代价：切换需要重启，不能在任务中自动路由模型。
- 重新评估：有明确的多模型任务需求并完成 Session/Capability 迁移设计时。

## D13 Resource 用户设置与本机运行时设置分离

- 背景：旧 `resource.json` 要求普通用户维护端口、进程间令牌、数据库、staging、并发、扫描和解压限制，且 Resident Host 没有正式启动入口。
- 决策：`resource.json` 只保存受管资源目录；固定安全默认值由 Resource 启动时派生。Host/Resource 的 loopback 地址和随机令牌保存在权限受限的 `~/.isla/runtime.json`。Worker 继续使用 Config/Profile，并通过 Resource Web 以 revision/CAS 原子修改。
- 理由：首次启动无需理解内部拓扑，同时保持 Config/Profile 为 Provider、模型和 API Key 的唯一事实源。
- 代价：目录或 Worker 设置修改后需要重启相应进程；当前不做动态热重载。
- 重新评估：真实使用证明热重载是高频需求，且能为 Scheduler、SQLite 和进行中 Job 定义无歧义迁移语义时。

## D14 Resource Web 工具台使用 React 渐进迁移

- 背景：Resource 工具台已经包含设置、目录浏览、任务创建、轮询、人工决策、重试、事件和资源树；内嵌 HTML/JavaScript 难以稳定维护局部交互状态和模块对齐。
- 决策：保留当前桌面信息结构，使用 React、Vite、TypeScript 和 TanStack Query 渐进迁移。服务端状态由 Query 管理，表单和展开状态留在局部组件；第一版不引入 Redux、Zustand、Next.js 或组件库。
- 理由：React 解决已经存在的浏览器状态同步问题；Vite 只承担前端构建，不让部署框架进入 Resource 核心；局部 CSS 能延续现有视觉语言并集中修复文本长度和网格对齐。
- 代价：构建与发布增加一份前端产物，迁移期需要短暂保留旧页面用于功能对照。
- 边界：Resource API、Job 状态机、SQLite、Scheduler 和文件处理保持不变；设置面板常驻展开；迁移完成后删除旧内嵌页面，不长期维护双 UI。
- 设计基线：见 [resource-ui-design.md](./resource-ui-design.md)。
- 重新评估：出现多个独立前端入口、跨页面共享客户端业务状态，或当前 API 无法支持所需交互时。

## D15 Resource 文件工作台使用受限操作与 Isla 回收站

- 背景：下载和解压目录需要改名、移动、删除、还原和继续解压；直接删除会造成误操作不可恢复。
- 决策：新增文件工作台，但所有操作只接受受管目录 ID 和相对路径。删除统一移动到 Isla 回收站，不调用直接删除；回收站默认保留 30 天、容量上限 100 GiB，超限按最旧优先清理。
- 理由：保持文件边界可审计、误删可恢复，并避免回收站无限增长。继续解压复用现有 `ArchiveOrganizer`、Scheduler 和任务状态机。
- 密码本：现有成功密码表扩展为可管理模块。局域网模式下明文展示，支持查看、新增、批量导入和删除；密码仍不得进入 URL、普通日志、持久化 Query Cache 或测试快照。
- 代价：需要新增文件操作、回收站和密码本 API，以及路径越界、冲突恢复和清理策略测试。
- 重新评估：需要跨受管目录操作、远程多用户访问或系统级回收站集成时，重新审查权限和凭据模型。

## D16 Resource 活动任务声明受管路径占用

- 背景：文件工作台已经能够重命名、移动、回收和还原文件；如果目标正在被 Resource Job 下载、检查、解压或发布，文件操作可能破坏任务事实和输出。
- 决策：非终态 Resource Job 根据 managed-file/managed-folder 输入和已记录 Artifact 派生受管路径声明。rename、move、trash 和 restore 在变更文件系统前检查路径交集，冲突时返回 `FILE_IN_USE`、Job ID 和安全相对路径。
- 理由：把资源所有权建立在现有 Job、Artifact 和数据库事实上，重启后仍可重建，不需要新的通用锁服务。
- 代价：检查与实际文件操作之间仍可能存在本机竞态；最终由原子文件操作失败收敛。未知或损坏的旧 Job 输入不会扩大占用范围。
- 边界：占用只约束受管目录；不引入分布式锁、常驻文件句柄或跨主机协调。
- 重新评估：Resource 成为主 Agent 背景能力、出现跨进程并发写入者，或真实竞态无法由当前原子操作收敛时。

## D17 Resource Web 只保留构建后的 React 实现

- 背景：React 页面稳定后，继续保留内嵌 HTML/JavaScript fallback 会形成两套行为和安全边界。
- 决策：删除旧 `src/resource/web-ui.ts`，Resource Service 只提供 `dist/resource-ui` 构建产物；缺失时返回明确的 `RESOURCE_UI_NOT_BUILT`，不静默回退。
- 理由：前端状态、文件工作台、密码本和任务操作只有一个事实实现，测试和发布包也能明确验证对应产物。
- 代价：源码运行前必须先构建 Resource UI。
- 重新评估：仅在出现独立的无前端诊断模式需求时增加窄诊断页，不恢复第二套完整 UI。

## D18 Resident Host Turn 流是临时观察

- 背景：一次性远程 CLI 需要实时呈现模型增量和 Tool 阶段，并能只取消当前 Turn。
- 决策：Host 使用现有 `ChatSession` 观察回调输出有界 NDJSON；每次 Turn 由 Host 生成 `turnId`，取消同时校验 `sessionId + turnId`。Session 继续是模型输入和有效回答的持久事实源。
- 理由：复用已有 Turn 回调和协作取消，不为 UI 建立第二份持久事件日志或通用事件总线。
- 安全与兼容：实时事件不包含 Tool 原始参数、Tool 结果正文或 Provider 原始错误；旧 JSON `/quick` 在迁移期继续可用。
- 代价：实时输出仅在当前连接中可见；客户端断开后不能续看。
- 重新评估：完整交互 CLI 需要远程审批/提问时增加绑定当前 Turn 的请求/响应事件；只有出现跨重连恢复需求时才评估持久事件游标。

## D19 Resource Job Bridge 保持为受限 Host Capability

- 背景：主 Agent 需要创建和检查跨 Session 生命周期的 Resource Job，但 Resource Service 已拥有可靠的 SQLite、Scheduler、Approval 和人工决定状态机。
- 决策：只在 Resident Host 装配六个 Job/Artifact Tool，经 loopback HTTP 调用 Resource；不把 SQLite、Scheduler、Worker 或任意文件路径注入 Agent。Profile 可用 `capabilities.resourceEnabled: false` 关闭这组工具。
- 理由：Resource SQLite 继续作为 Job 事实源；Session 只保存 Tool 引用和当前结论，Host/CLI 退出不影响 Job。
- 幂等：Host 从 Session、Turn 和 Tool Call 身份派生 SHA-256 键；Resource 在 SQLite 事务内同时写入 Job 与幂等响应。记录随 Resource 数据库保留，不自动过期。
- 秘密边界：分享码、压缩包密码和登录验证码不经过 Agent Tool 参数，因为模型 Tool Call 会持久化到 Session；对应决定继续由 Resource UI 的秘密输入路径完成。
- 重新评估：存在无需把秘密交给模型的受控用户输入通道，且实测 Resource Job 查询/重试语义稳定后，才考虑扩展远程秘密决定协议或幂等记录清理策略。

## D20 完整 Agent 基础设施是个人 Agent 的产品基线

- 背景：Isla 已经拥有 Session、Memory、Capability、Approval、MCP、Browser、Host 和 Resource，但生命周期与协议分散；继续按“当前未使用”推迟 Web UI、Plan/Act、事件化 Session、执行环境和扩展生命周期，会让每个新能力重复改造组合根。
- 决策：采用 [Agent Platform 基线](./agent-platform-baseline.md)。先建设 Service/Scope/Effect Runtime Kernel，再演进 Event Session、App Server、Policy/Execution、Plan/Act、主 Agent Web UI、完整 MCP、Job 与受限 Subagent。
- 参考：采用 DeepSeek Harness/Cordis 的服务图和作用域思想、Codex 的 App Server/Approval/Sandbox 分层、OpenHands 的多界面 Runtime 与会话恢复、Cline 的 Plan/Act 权限模式、SWE-agent 的环境和工具安装边界；不复制其源码或项目目录。
- 理由：个人产品仍需要成熟 Agent 的基础服务；这些契约越晚补，Session、UI、工具、插件和后台任务的迁移成本越高。
- 代价：短期增加基础设施和迁移工作；必须通过兼容层避免一次性重写。
- 边界：不扩展为公网多租户 SaaS，不允许无边界递归 Agent、自主演化或未经批准的在线代码执行。
- 重新评估：仅当公开协议或成熟依赖能完整替代某层时，考虑直接采用依赖而不是维护自有实现。

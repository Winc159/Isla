# Isla v0.8.0.0：主 Agent Web UI

## 设计目标

提供与 CLI 等价的本地主 Agent Web UI，完全通过 App Server 协议工作，不直接读取 Session、Memory、配置文件或 Resource 数据库。

## 页面与功能

- Session 列表、搜索、创建、归档和恢复。
- 实时对话、断线续传、停止、steer 和 follow-up。
- Approval/User Question 队列与历史。
- Plan/Act/Review 模式、计划步骤和验证状态。
- Tool 时间线、命令输出 cursor、Artifact 预览和差异。
- Job 视图：主 Agent Job 与 Resource Job 只读投影。
- Memory 查看、来源、修订和删除。
- MCP 管理、健康状态和 OAuth 流程入口。
- Provider/Profile、权限规则、执行环境和诊断设置。

## 实施步骤

1. 在独立 `agent-ui/` 建 React/Vite/TypeScript 应用；不复用或修改 `resource-ui/`。
2. 生成 App Server TypeScript Client 和事件状态机。
3. 实现 Session/Turn 核心页面和重连。
4. 实现审批、问题、Plan、Tool、Artifact。
5. 实现 Job、Memory、MCP、Settings、Diagnostics。
6. 增加无障碍、键盘导航、响应式和错误恢复。
7. Host 只提供构建静态资源和 loopback 鉴权。

## 状态边界

- 服务端状态由 query/cache 管理；实时事件按 cursor reducer 合并。
- 编辑器草稿和 UI 展开状态本地保存；秘密、Tool 原始敏感输出和凭据不持久化到浏览器。
- 同一 Approval 只能被一个客户端成功响应；其他客户端收到 resolved 事件。

## 自动测试

- reducer 对乱序、重复、断线补发事件的幂等测试。
- Playwright 覆盖会话、流式、审批、计划、取消、重连和错误页。
- XSS、Markdown、Tool 输出、URL、下载和 secret redaction。
- 键盘操作、ARIA 和最低视口。
- App Server 版本不兼容与升级提示。

## 真实验收

- 仅用 Web UI 完成一个小型代码修改任务：检查工作区、制定并批准结构化计划、创建文件、运行测试并检查差异；不包含 PDF 或依赖安装专项验收。
- 浏览器刷新后恢复当前 Session、Turn 和等待中的 Approval。
- CLI 与 Web 同时观察同一 Turn，事件一致且不会重复执行。
- Resource UI 保持独立可用，样式和构建互不影响。

真实验收补充（2026-10-28）：完成一次 Web→刷新→待审批→恢复的浏览器真实流程，刷新后同一 Session、活动 Turn、原审批卡片均恢复，批准后 Turn 正常结束；另完成 Web UI 内真实只读任务，工具审批后 `node --test slugify.test.mjs` 通过，Act 计划有对应证据。移动端 390×844 与窄桌面 800×900 检查中，移动会话入口可打开/选择/关闭，Escape 可收起；桌面样式保持。以上是手工 CUA 验收，不是 Playwright 门禁。

实现修复与自动复验（2026-10-28）：真实 UI 流程暴露模型以普通最终回答结束、未调用 `submit_result` 时 Act 计划停在待完成，Runtime 已改为仅在成功证据能逐步匹配全部计划步骤时才自动结算；不足则仍拒绝完成。另发现 Web 页面仅在本页面已知活动 Turn 时才轮询，CLI 从同一 Session 发起 Turn 时页面无法自动发现。已新增 idle-session 活动 Turn 发现轮询并完成 Agent UI 生产构建。随后全量 `node scripts/verify.mjs` 通过：174 个测试文件通过、7 个跳过，722 项通过、13 项跳过，TypeScript、Runtime、Resource UI、Agent UI 构建均成功。

CLI→Web 同一 Turn 的端到端浏览器验收仍未完成：CLI 的第一次真实交互因宿主终止交互式 stdin 而未能可靠提交请求；检查同一 Session 的事件 API 时，该请求已被取消并留下 `turn_cancelled`，不能作为通过证据。Host 仍健康且未重启；等待使用可保留交互 stdin 的终端方式复测。此项不影响上面的 Host 多客户端自动化测试，但也不应据此宣称浏览器跨入口真实验收通过。

模型切换复测补充（2026-10-28）：按用户要求将本机默认 Bailian Profile 切换至 `qwen3.5-122b-a10b`；新 Host 创建的隔离评测 Session 已确认使用该 provider/model。原浏览器会话仍绑定旧模型，Host 按 provider/model 隔离 Session，因此旧会话发起 Turn 返回 `SESSION_NOT_FOUND`；已保留旧会话，并建立新模型隔离 Session。之后通过本地 Web UI 实际完成了工作区检查、结构化计划、用户批准和测试命令执行；测试命令成功，但该 Turn 在工具返回后以通用 `TURN_FAILED` 结束，未收到模型总结，故不算真实任务通过，也不能确认其原因为额度耗尽。独立本地运行的 5 个 slugify 断言全部通过，测试夹具文件未被修改。浏览器刷新后恢复了同一 Session 的消息、Act 模式和已保存计划；当时没有活动 Turn 或等待中的 Approval，因此不覆盖活动交互恢复。为使后续错误可诊断，Host 现在保留安全 RuntimeError code（例如 `PROVIDER_RATE_LIMIT`），并有回归测试；在资源状态确认前不继续发起模型请求。

## 实施记录（2026-10-28）

已完成第一阶段基础能力：新增独立 React/Vite 主 Agent 工作台；Host 在配置构建产物时提供静态页面与同源 loopback bootstrap；增加 workspace 选择、Session 创建/选择、实时 Turn 事件回放与显式取消、Approval/User Question、结构化 WorkPlan 编辑与 Act 审批、工具活动、Checkpoint、Memory 查看、Resource Job 只读视图、MCP 状态只读视图及设置/诊断入口。Resource UI 未复用或修改。

自动验证：TypeScript typecheck、Runtime 构建、173 个测试文件通过（7 个跳过；719 个测试通过、13 个跳过）、Resource UI 构建和 Agent UI 构建。Host UI 静态资源、bootstrap 安全边界、resumable Turn、Session 搜索/归档、follow-up、进程 owner 与输出 cursor 专项测试包含在测试套件中。`git diff --check` 通过。

真实对话验收未通过：浏览器真实流程可连接 Host、创建并批准结构化计划、发起 Turn，并在写文件时显示 Approval；批准 `slugify.mjs` 写入后 Turn 停止，目标工作区未生成文件，测试和差异检查未执行。此失败属于 Agent 执行闭环问题，不能判定 8.0.0 验收通过。

修复记录：真实测试暴露远程 Approval 响应被取消回调覆盖的问题，Host 现已在成功响应时直接结算 Approval，并以 Host 回归测试覆盖实际批准后的 Turn 完成。继续验收又暴露 Act 计划进度依赖模型主动调用 progress 工具；Runtime 现会在 `submit_result` 时将已成功的只读观察、实际写入和通过的验证映射到不同计划步骤并结算，缺少任一步证据仍拒绝完成。新增 Session 回归测试覆盖检查→修改→验证全链路。

真实任务复测通过（最新 Host 构建，2026-10-28）：只通过 Web UI 创建新 Session、编辑并显式批准结构化 WorkPlan、发起实际 Turn、批准工具、运行测试并检查文件；UI 显示 Turn 已完成，计划 3/3 步均有证据。Isla 创建 `slugify.mjs` 与 `slugify.test.mjs`，首轮发现大小写用例失败，后续批准修复后复测成功。Host 中的 Node 测试命令退出码为 0；另以项目 Node 24 对相同文件独立运行，5/5 个测试通过。检查了测试输出与两个源文件，没有安装依赖或访问工作区外文件。

本次真实对话中的修复：远程 Approval 不再被清理回调误结算为拒绝；Act 在有每步独立且匹配的成功证据时由 Runtime 结算 Plan 进度，不依赖模型额外调用 progress 工具。自动化回归与 UI 真实任务均通过。

补齐记录（2026-10-28）：Host 现在支持按会话消息搜索、归档列表、归档/恢复，并在 Session JSON v7 中持久化 `archivedAt`；归档不会删除历史或改动 Resource 数据。归档 Session 不参与默认恢复和 `/quick` 复用，也不能发起新 Turn；活动中的 Session 拒绝归档。Web 侧栏提供搜索、归档列表切换和当前会话归档/恢复。另已加入远程 follow-up 队列：每条提示由幂等 ID 去重，严格串行执行且每条获得独立 Turn ID；取消、失败和关闭时不执行残余队列。队列仅保存在 Host 进程内存，浏览器刷新可从活动 Turn 恢复队列，但 Host 重启会丢弃队列。执行器视图现在可按 Session owner 和 workspace 读取进程状态及 cursor 增量输出；Host 只投影安全状态字段，不向 UI 暴露 argv 或绝对路径，Resource 服务未改动。Steer 尚未实现，避免将“取消后重发”伪装成安全 steer。存储、Host API 集成、全量测试、类型检查和两个 UI 构建已通过；自动化浏览器检查因当前执行环境拒绝启动 Chromium（`spawn EPERM`）未能执行，Codex 浏览器连接也不可用，不能据此宣称浏览器验收通过。

尚未完成：远程 steer、通用 Artifact 预览与差异、MCP 配置与 OAuth、Provider/Profile 和权限设置完整管理、自动化浏览器/无障碍/XSS 覆盖，以及 CLI/Web 同一 Turn 的跨入口真实一致性验收。Host 层的双客户端事件回放已有回归测试，但不等于浏览器端多客户端验收。follow-up 队列跨 Host 重启恢复也尚未支持。以上包含多个需要独立设计验证的功能；在计划边界核对前，不将它们默认视为本次 8.0.0 验收的隐含范围。

自动验证复测（2026-10-28）：修复失败 Turn 的 RuntimeError code 丢失问题后，Host 专项测试 14/14 通过；完整 `scripts/verify.mjs` 通过，174 个测试文件中 7 个跳过、721 项通过、13 项跳过，Resource UI 与 Agent UI 生产构建均成功。该结果证明自动化回归通过，不替代上文未完成的真实 UI 与交互恢复验收。

多客户端覆盖补充（2026-10-28）：Host 回归测试现验证两个独立 Web Client 可以并行读取同一 Turn 的事件回放和终态事件，收到相同事件序列，且并行观察不会重复执行模型 Turn；两个客户端同时响应同一 Approval 时恰有一个成功，另一响应收到冲突结果。该测试不替代 CLI 与 Web 的跨入口真实一致性验收，也不覆盖浏览器自动化。

检查点差异呈现补充（2026-10-28）：工作台现在将 Host 已安全筛选的检查点预览呈现为“将恢复/将移除”文件清单和可读 unified diff，并将敏感内容、二进制、过大或截断差异显示为明确省略原因，不再把整份结构化响应当作 JSON 展示。此项只改善现有工作区检查点预览，不代表通用 Artifact 查看器已完成。

## 完成条件

- Web UI 可独立完成 CLI 已支持的全部主 Agent 交互。
- 刷新、断线和多客户端不会丢事件或重复副作用。
- Approval、问题、Plan、Artifact 和 Job 都有明确等待与终态展示。
- 安全、无障碍和 Playwright 门禁通过；Resource UI 零回归。

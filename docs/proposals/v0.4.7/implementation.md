# v0.4.7 实施步骤

按 Batch 顺序实施，每个 Batch 必须通过 typecheck、相关测试、diff check 和资源清理测试后才能进入下一 Batch。Luna 不得提前实现支付、任意 JavaScript、noVNC 或公网监听。

## Batch A：Browser Adapter 与安装检查

1. 增加 Playwright Browser Adapter seam 与进程所有权模型。
2. 增加 `browser check/install`；install 只在用户显式调用时下载 Chromium，不执行 sudo。
3. 实现临时 Browser Profile、launch、page、close、crash 和 shutdown 收敛。
4. 建立 synthetic local fixture 页面，不连接真实网站。
5. 验证 Linux 无 DISPLAY 条件下可启动 headless Chromium。

停点：可以在无头 Linux 打开 fixture、取得截图并完全关闭进程树；缺浏览器时错误可操作。

## Batch B：观察与受控交互 Tool

1. 实现页面快照、短期 element ref 和密码字段屏蔽。
2. 接入 `browser_open/navigate/observe/click/type/select/wait/scroll/back/close`。
3. 禁止 CSS/XPath、任意 JavaScript、`file://` 和未授权私网目标。
4. 接入 Capability Snapshot、ToolRuntime、Approval、取消、Journal 和预算。
5. 对 DOM、截图、Tool Result 设置大小与频率限制。
6. 使用 accessibility/可见语义树生成 snapshot；每个 ref 绑定 tabId + documentId。
7. 增加 `browser_find` 与 cursor-based `browser_read`，避免整页 DOM/正文进入上下文。
8. 动作结果只返回有界 delta；增加无进展检测和每回合/每任务步骤预算。

停点：模型可在 fixture 中完成导航、填写普通文本和提交低风险表单；密码 value 不可见。

额外阻断：不得用 CSS nth 序号充当稳定 ref；document 变化后旧 ref 必须返回 `STALE_REF`。

## Batch C：Resident Host Browser API

1. 在现有 Host 增加 Browser Session API、ownership、限流和事件流。
2. 仅允许 loopback bind，复用 bearer 后换短期 Browser Console Session。
3. 增加 Origin、CSRF、SSE/截图认证和断线语义。
4. 实现截图内存缓存和事件触发刷新，不落盘。
5. 验证 Host shutdown、Browser crash 和断线后的唯一状态。

停点：通过 SSH tunnel 可访问受认证 API；非 loopback、无 token、错 Origin 和错 CSRF 全部拒绝。

## Batch D：Browser Console 与人工接管

1. 创建最小 Console：截图、URL、Origin、状态、动作记录和控制按钮。
2. 实现截图点击坐标映射、普通键盘输入、后退、刷新、暂停和关闭。
3. 实现 `agent_control ↔ user_control` 原子切换。
4. 用户断线时保持暂停，不自动恢复 Agent。
5. 增加登录/验证码专用 secret 输入入口，确保前端和服务端不记录内容。

停点：用户能通过浏览器控制台完整人工登录 synthetic fixture；模型没有收到任何输入值。

## Batch E：加密密码簿

1. 实现 versioned vault、scrypt、AES-256-GCM、AAD、sentinel 和原子写入。
2. 实现 locked/unlocked/timeout/lock 状态，不持久化 master key。
3. 实现首次保存、列出脱敏条目、重命名和删除审批。
4. 实现精确 HTTPS Origin 匹配；loopback HTTP 只用于 fixture。
5. 完成权限、损坏文件、错误主密码、并发写和中断恢复测试。

停点：磁盘搜索、日志和 Session 中不存在明文 secret；错误主密码不能解密或破坏 vault。

## Batch F：y/n/other 凭据审批与 Runtime 注入

1. 实现 `browser_request_credential`，模型只传 origin/purpose。
2. CLI 与 Browser Console 显示同一 Approval：credential label、username hint、origin、purpose。
3. 实现 y 一次授权、n 拒绝、other 选择其他/手输/人工接管。
4. Runtime 在审批后直接填 username/password；Tool Result 只返回稳定状态。
5. 导航、刷新、Origin 变化、Session 变化和超时使授权失效。

停点：Agent 无法通过任何 Tool、日志、错误、诊断或页面 observation 获得 secret。

## Batch G：下载、上传与安全收口

1. 增加显式开关、workspace 目录和 Approval。
2. 实现文件名规范化、防覆盖、大小上限、MIME 与哈希摘要。
3. 阻止 home、配置、密码簿、Session 和浏览器 profile 被上传。
4. 增加恶意网页 prompt injection、跨 Origin iframe、弹窗和重定向测试。
5. 完成取消、崩溃、关闭和孤儿进程扫描。

停点：文件与网络边界不弱于现有 ToolRuntime 和 web_fetch。

## Batch H：Linux/SSH 真实验收

1. 在无 GUI Linux 安装 Chromium 并启动 Resident Host。
2. 从另一台机器使用 `ssh -L` 访问 Browser Console。
3. 完成首次人工登录、保存凭据、锁定、重新解锁。
4. 新 Session 中由 Agent 请求凭据，分别实测 y、n、other。
5. 完成一个低风险真实网站任务；不使用支付、发布或删除操作。
6. 重启 Host，确认 vault 锁定、Browser Profile 策略和孤儿进程状态。
7. 归档脱敏事件、截图哈希、耗时和进程证据，不归档截图正文或密码。

停点：真实 Linux、SSH、人工接管和凭据审批闭环通过后，才允许声明 v0.4.7 核心验收通过。

## Batch I：通用 Agent Loop 动态预算

1. 将固定 `DEFAULT_MAX_TOOL_ROUNDS` 重构为 Runtime-owned `LoopBudgetState`，不得放入 BrowserRuntime 或单个 Tool。
2. 定义 Step、Tool group、失败、等待用户、超时和硬上限的唯一计数语义。
3. 从 ModelStepEvent、Tool Result、TaskState、Journal 和可信 source 构建 `ProgressEvidence`；Tool 可提供领域 fingerprint，但不能决定续租。
4. 实现最近 6 Step 的重复 action/result、相同错误和 A-B 循环检测。
5. 在剩余 2 Step 时评估；满足条件自动增加最多 8 Step，自动上限 28，默认硬上限 40，可配置上限 100。
6. 增加一次 wrap-up/换策略提示；提示后仍无进展则停止，不重复续租。

### Batch I 当前实现状态（2026-09-24）

- 已实现 `src/core/loop-budget.ts`，预算属于通用 `ChatSession` Agent Loop，不依赖 BrowserRuntime。
- 默认从 12 步开始；在剩余 2 步且最近样本没有重复动作/相同错误时，自动按 8 步扩展到 20、28。
- 达到 28 步后通过 `UserQuestionService` 询问“继续/停止”；继续可扩到 36、40，40 为当前硬上限；无交互服务或选择停止时安全返回 blocked。
- 已接入 `SessionFactory`，CLI/PTY/NDJSON 使用同一询问链路。
- 已新增 `browser_request_user_control`：Agent 可在登录提交、验证码或人工网页操作前暂停，Browser Console 提供“接管”和“完成并继续”，释放后才恢复 Agent。
- `browser_request_credential` 的 `other` 已扩展为二段式停点：用户可选择安全通道手工输入账号/密码，或选择 `user_control` 接管网页；接管流程会提示目标网址，用户完成跳转/输入后选择 `enter`，再释放控制权。
- Browser Console 已接入 CLI Host 生命周期并固定监听 `127.0.0.1:43119`；CLI 启动时输出 Console URL 和本次随机 token。人工接管提示同时显示 Console URL、目标 origin 和 sessionId；端口占用时明确启动失败，不自动漂移。
- 已补齐最近 6 个样本的 A-B 交替循环检测，以及续租/用户续租/停止事件的 Journal 记录；模型请求已有既有的 context/token 门禁。
- 已补齐独立 wall-clock loop timeout（默认复用 Runtime timeoutMs，默认 10 分钟）和一次模型可见的 wrap-up/换策略提示。
- 本批验收：`npm run verify` 通过（110 个测试文件，452 个测试通过，8 个文件/11 个测试跳过）。Windows `node-pty` 的 `AttachConsole failed` 为既有测试环境噪声，测试进程仍成功退出。
7. 超过自动上限时通过现有 UserQuestionService 发出继续/停止/调整目标；NDJSON 与 CLI 等价。
8. Journal 记录预算变更和 stop reason；Session 恢复不得恢复过期的 Turn 预算或等待请求。
9. 将 Browser 当前“连续三次无变化”迁移为通用 loop detector 的领域信号，删除重复控制逻辑。
10. 完成后再评估是否把 `DEFAULT_MAX_TOOL_ROUNDS` 保留为兼容别名；不得直接删除硬上限。

停点：文件读取/编辑、命令验证、MCP、Session Query 和 Browser 五类 synthetic flow 均能合理续租；循环 fixture 在有限 Step 内稳定熔断；用户停点可继续、停止或调整目标。

## Batch J：真实用户接管、跨平台显示与智能登录

1. 把控制权统一为 Runtime-owned `BrowserControlLease + controlEpoch`；Console 完成按钮和 CLI `enter` 调用同一幂等 release，不再维护两套状态。
2. release 后强制 settle、切换到最新 popup/tab、更新 documentId、废弃旧 ref、重新观察；任一步失败均保持安全暂停。
3. 增加 `browser.presentation=native|console|auto`。Windows/macOS 桌面默认 native；Linux 根据 DISPLAY/Wayland/无头环境选择 native 或 console，允许 Profile 显式覆盖。
4. 保留原生窗口让用户观察 Agent，不实现 headless→headed 热迁移；Console 远程视图补齐 tab/popup、坐标、键盘、滚动、resize 和断线状态。
5. 增加 Console 双栏账号/密码安全表单，绑定精确 session/tab/document/origin 和已验证字段 ref；账号与密码都绕过 LLM、CLI 历史、普通 API 日志和 Journal。
6. 实现 `CredentialFillService` 与待保存 secret 的短生命周期；默认仅本次使用，只有登录成功后才询问保存，并在确认后调用 Vault 原子写入。
7. 实现 `LoginOutcomeDetector`：综合 URL、document、表单、可见错误、账户语义、redirect、popup 和挑战元素，输出 authenticated/challenge/invalid/still/unknown。
8. challenge 自动进入人工接管；OTP/CAPTCHA/passkey/device confirmation 由用户处理，释放后重新判定，不保存挑战内容。
9. 接通 Vault `y` 路径：解锁→精确 Origin 查询→一次性 Approval→Runtime 填充→智能判定；不再返回占位 `VAULT_CREDENTIAL_REQUIRED` 后停止。
10. 增加真实 macOS headed、Linux desktop headed、Linux headless+SSH 三组验收；没有对应平台证据时只能标记“设计支持”，不得声明通过。

停点：同一真实对话中，用户只需自然语言提出“登录后继续”；可观察 Agent 操作、一次完成接管和释放、处理一次挑战、选择是否保存，并在新 Session 通过 Vault 完成登录。控制状态无二次 enter，模型和日志中无 secret。

## Batch K：分层上下文与可回取细节

1. 抽出通用 `ContextCompactionService`，不要把 compaction 放在 Browser 或 Agent Loop 专用逻辑中。
2. 为 Session surface 增加稳定的 message/turn/tool-result seq；摘要替换只改变当前 surface，原始消息和 tool result 仍可由 Session Store 查询。
3. 实现 `ToolResultPruner`：超限结果按 head/middle/tail 裁剪，保留 toolCallId、状态、摘要和 sourceId；截图、长正文和重复 accessibility snapshot 先裁剪。
4. 实现 token pressure 水位：正常水位、警戒水位、overflow recovery 水位；每次裁剪或摘要后重新测量完整请求，包括工具 schema和输出预留。
5. 只选择 tool call/result 配对完整的连续旧范围调用压缩 LLM；生成结构化摘要并落盘 `compaction/start/summary/replace/end` 事件。
6. 将当前单一 checkpoint 改为 L3 摘要节点＋L4 原文索引；当前请求不重复附带已替换的旧消息。
7. 增加通用 `context_find/context_read` Tool，模型只有在需要历史证据时显式回取细节；返回内容有 cursor 和 token 上限。
8. 失败请求关闭后触发一次 `context-overflow` recovery：先 pruner，再 compact，再重新派生请求；如果单个保留节点仍超过预算，返回明确不可修复错误。
9. `/compact`、自动压缩、恢复会话使用同一队列锁；启动发现未关闭的 compaction 或 running turn 时，先恢复/标记失败，不把损坏状态直接暴露给模型。
10. 删除“仅按任务关键词缩减工具 schema”作为主要策略；它只能作为最终 envelope 保护，并记录降级原因。

停点：长时间 GitHub/小红书对话中，工具结果被先裁剪，旧回合由 LLM 摘要替换；模型可通过 `context_find/read` 找回某个登录结果、帖子或页面片段；当前请求稳定低于预算，且 Session 日志仍可重建原始历史。

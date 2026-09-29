# v0.4.7 测试设计

## 1. Browser 生命周期

- `BROWSER-001`：缺少 Chromium 时 `browser check` 返回可操作错误，不在普通启动时下载。
- `BROWSER-002`：无 DISPLAY Linux 可启动 headless Chromium。
- `BROWSER-003`：临时与持久 Browser Profile 路径严格隔离。
- `BROWSER-004`：同 Isla Session 首版只能绑定一个活动 Browser Session。
- `BROWSER-005`：全局并发上限生效。
- `BROWSER-006`：close、cancel、crash、Host shutdown 后无孤儿 Chromium/driver。
- `BROWSER-007`：Host 重启不恢复未完成动作或一次性 Approval。

## 2. 页面观察与交互

- `BROWSER-010`：observe 返回有界语义节点和短期 ref。
- `BROWSER-011`：导航/显著 DOM 更新后旧 ref 稳定失效。
- `BROWSER-012`：密码字段 value、Cookie、Storage 和 Header 不进入 observation。
- `BROWSER-013`：click/type/select/wait/scroll/back 在 synthetic fixture 正确执行。
- `BROWSER-014`：普通 `browser_type` 拒绝 password/OTP/secret 字段。
- `BROWSER-015`：CSS、XPath、任意 JS、CDP 和 `file://` 不可由模型调用。
- `BROWSER-016`：跨 Origin iframe 节点带来源且不能继承凭据授权。
- `BROWSER-017`：网页 prompt injection 不能修改 Permission、Approval 或 allowed origin。
- `BROWSER-018`：页面观察、Tool Result 和截图频率/大小上限稳定。
- `BROWSER-019`：snapshot 由 accessibility/可见语义树产生，不包含完整 HTML、隐藏 prompt、表单 value。
- `BROWSER-020`：每个 ref 同时绑定 tabId + documentId；DOM document replacement 后返回 `STALE_REF`，不得按 nth 重新定位。
- `BROWSER-021`：`browser_find` 只返回匹配节点、路径和少量上下文，最多 10 项。
- `BROWSER-022`：`browser_read` 默认不超过 3500 字符，cursor 可继续读取且无重复/跳段。
- `BROWSER-023`：动作结果仅返回状态和有界 delta，不自动附带整页 snapshot。
- `BROWSER-024`：连续三次无页面变化或相同错误后停止并请求用户帮助。
- `BROWSER-025`：模型不能通过构造 ref、CSS、XPath、文本 selector 或 nth index 绕过 snapshot ref table。
- `BROWSER-026`：tab/new/switch/close、popup、dialog、forward/reload/key 行为稳定且不抢 OS 焦点。

## 3. Console 与网络

- `CONSOLE-001`：只允许 loopback；`0.0.0.0`、公网 IP 和网卡 IP 拒绝启动。
- `CONSOLE-002`：无/错 bearer 无法获取 Console Session。
- `CONSOLE-003`：Token 不进入 URL、浏览器历史、HTML 或日志。
- `CONSOLE-004`：Origin 与 CSRF 校验覆盖全部写 API。
- `CONSOLE-005`：截图、SSE 和控制 API 均验证 Browser Session ownership。
- `CONSOLE-006`：截图默认只驻留内存，关闭 Session 后释放。
- `CONSOLE-007`：点击坐标在 viewport 缩放、滚动和 resize 后映射正确。
- `CONSOLE-008`：用户接管时 Agent 动作暂停，释放后重新观察再继续。
- `CONSOLE-009`：Console 断线保持 user_control，不自动恢复 Agent。
- `CONSOLE-010`：经 `ssh -L` 可用，但 Host 监听地址仍为 loopback。
- `CONSOLE-011`：首次真实 browser_open 自动监听 `127.0.0.1:0`，只输出实际 Console URL，不输出 bearer。
- `CONSOLE-012`：Bearer 只用于换短期 HttpOnly session cookie；cookie、CSRF 和 token 不进入 URL。
- `CONSOLE-013`：SSE 重连只恢复状态版本，不回放 secret 或过期 Approval。
- `CONSOLE-014`：CLI `enter` 与 Console“完成并继续”竞争释放同一 controlEpoch 时只有一个 released 终态，另一操作幂等成功。
- `CONSOLE-015`：重复 user-control 请求复用当前 lease，不创建嵌套停点；恢复后下一轮不会残留 `BROWSER_USER_CONTROL_ACTIVE`。
- `CONSOLE-016`：release 后先切换最新 popup/tab、更新 documentId 并重新观察，旧 ref 全部返回 STALE_REF。
- `CONSOLE-017`：Windows/macOS native 模式从创建起显示窗口；用户未接管时页面输入不会绕过 ownership。
- `CONSOLE-018`：Linux 有 DISPLAY/Wayland 可运行 native；无显示环境 auto 回退 console/headless，并给出明确诊断。
- `CONSOLE-019`：SSH 隧道关闭时保持 user_control；重新连接后同一 controlEpoch 可继续，不暴露 Host 到非 loopback。
- `CONSOLE-020`：OAuth popup、新 tab、viewport resize、滚动和中文输入在 Console 远程模式可用；iframe 嵌入不是验收路径。

## 4. Vault 密码学与存储

- `VAULT-001`：新 vault 包含 version、salt、KDF 参数和加密 sentinel，不含主密码。
- `VAULT-002`：相同密码保存两次产生不同 nonce/ciphertext。
- `VAULT-003`：AES-GCM AAD 篡改 record id/origin/field 后解密失败。
- `VAULT-004`：错误主密码无法解锁，且不会改写 vault。
- `VAULT-005`：损坏、截断和未知版本返回稳定错误，不丢原文件。
- `VAULT-006`：原子写中断后旧 vault 仍可读取。
- `VAULT-007`：目录 0700、文件 0600；权限过宽时拒绝或明确修复。
- `VAULT-008`：lock、timeout、shutdown 后 key 不再可用。
- `VAULT-009`：失败解锁触发内存级退避，重启不写入失败密码。
- `VAULT-010`：磁盘、Session、Journal、cache、诊断和日志扫描无明文 secret。

## 5. Origin 与凭据审批

- `CRED-001`：凭据只匹配规范化精确 Origin。
- `CRED-002`：`example.com` 不匹配 `evil-example.com`、子域名或不同端口。
- `CRED-003`：非 HTTPS Origin 不能保存，fixture loopback 例外由测试配置显式开启。
- `CRED-004`：模型只能看到 available、label、usernameHint 和 approval required。
- `CRED-005`：y 只授权一次、当前 Browser Session、当前 Origin。
- `CRED-006`：n 返回 USER_REJECTED，同一回合不能循环骚扰用户。
- `CRED-007`：other 可选择另一凭据、手工输入或人工接管，选择详情不进入模型。
- `CRED-008`：导航、Origin 变化、刷新、Session 变化和超时使授权失效。
- `CRED-009`：找不到表单、多个候选表单和动态替换字段时不把 secret 填到未知元素。
- `CRED-010`：填写后 Tool Result 只有稳定状态，异常 cause 不含 secret。
- `CRED-011`：首次保存前显示精确 Origin、label、usernameHint 并再次确认。
- `CRED-012`：密码修改、支付和二次认证默认 deny。
- `CRED-013`：一次性授权绑定 sessionId、tabId、documentId、origin、credentialId 和 expiry。
- `CRED-014`：Console secret endpoint 的 body、异常、访问日志和事件中均无 secret。
- `CRED-015`：CredentialFillService 只向已验证的 username/password 控件填值；歧义表单必须停止。
- `CRED-016`：Console 双栏账号/密码请求和响应不进入 access log、Session、Journal、诊断、异常、截图元数据或模型上下文。
- `CRED-017`：默认仅本次使用；选择“成功后询问保存”也不得在 authenticated 前写 Vault。
- `CRED-018`：登录成功后的保存确认显示精确 Origin、label 和脱敏账号；拒绝、超时、导航换 Origin 后待保存 secret 被销毁。
- `CRED-019`：Vault `y` 实际完成查询、一次授权和字段填充，不允许以 `VAULT_CREDENTIAL_REQUIRED` 占位状态宣称完成。
- `CRED-020`：账号/password 字段存在多个候选或跨 Origin iframe 时停止并要求用户确认，不尝试猜测。

## 5.1 登录结果与挑战

- `AUTH-001`：登录表单消失、document 变化且出现账户语义时返回 authenticated/high。
- `AUTH-002`：仅 URL 改变但仍存在登录表单时不得判定成功。
- `AUTH-003`：错误密码提示返回 invalid_credentials，不保存凭据、不自动重复提交。
- `AUTH-004`：OTP/TOTP/短信/邮箱验证码返回 challenge/otp 并自动停点，验证码不进入模型或 Vault。
- `AUTH-005`：CAPTCHA 返回 challenge/captcha；截图可展示给用户，但识别结果不得被 Agent 用于自动绕过。
- `AUTH-006`：passkey/WebAuthn、安全密钥和设备确认返回对应 challenge，由用户在原生窗口或 Console 完成。
- `AUTH-007`：用户完成挑战并释放后重新观察；只有新结果为 authenticated 才继续账户任务。
- `AUTH-008`：unknown/medium confidence 不宣称成功；询问用户或保持停点。
- `AUTH-009`：相同 fingerprint 和结果连续两次时停止自动提交，避免锁号与风控升级。
- `AUTH-010`：OAuth popup 成功关闭后切回发起 tab，并以发起站点的登录状态作为最终结果。

## 5.2 分层上下文与压缩

- `CTX-001`：请求 token 估算包含系统提示、工具 schema、历史、图片/Tool Result 和输出预留。
- `CTX-002`：超大 Tool Result 先进行 head/middle/tail 裁剪，保留 toolCallId、状态和 sourceId。
- `CTX-003`：压缩范围只包含完整的旧 user/assistant/tool call/result 配对，不能产生孤立 Tool Result。
- `CTX-004`：LLM 摘要包含目标、结论、证据、待办、失败和 source 引用，不包含 secret 或思维链。
- `CTX-005`：摘要替换后原始消息不再进入当前请求，但仍可由 context_find/read 查询。
- `CTX-006`：`context_find` 只返回有界匹配和引用；`context_read` 支持 cursor，不能一次恢复全部历史。
- `CTX-007`：自动 pressure、provider overflow recovery 和 `/compact` 使用同一压缩服务和锁。
- `CTX-008`：压缩失败不会丢失原始 surface；compaction start 无 end 时启动恢复会安全标记失败。
- `CTX-009`：压缩后重新测量完整 envelope；若仍超限可进行多轮压缩，而不是直接切换到无历史的模型请求。
- `CTX-010`：单个当前 Tool Result 或工具 schema 本身超过预算时返回不可修复错误，并说明具体组成。
- `CTX-011`：`context_find/read` 回取的细节只进入当前回合临时窗口，不永久膨胀主 surface。
- `CTX-012`：长 GitHub/小红书真实对话至少发生一次 tool-result pruning、一次 LLM summary 和一次 context detail recall。

## 6. 下载、上传与私网

- `FILE-001`：下载关闭时任何 download 都拒绝。
- `FILE-002`：下载只能进入配置目录，路径穿越和覆盖拒绝。
- `FILE-003`：上传只能选择 workspace allowlist 文件。
- `FILE-004`：Config、Session、vault、Browser Profile、SSH key 和 home 文件不能上传。
- `FILE-005`：大小、MIME、文件名和哈希摘要有界且不泄露内容。
- `NET-001`：默认阻止 localhost、私网、metadata IP、`file://` 和危险 scheme。
- `NET-002`：重定向到不同 Origin 后旧凭据授权失效。
- `NET-003`：DNS/连接变化不能绕过目标校验。

## 7. 兼容与回归

- `REG-001`：Browser 未启用时现有 CLI、NDJSON、Host 行为不变。
- `REG-002`：web_fetch/web_search 不自动获得 Cookie 或 Browser Profile。
- `REG-003`：Tool、Skill、MCP、Shell、Context Budget 和 Session tests 全绿。
- `REG-004`：Browser Capability Snapshot 与实际 Tool 路由一致。
- `REG-005`：模型不支持 Tool Calling 时 Browser Tool 不暴露，不接受文本伪调用。
- `REG-006`：npm tarball 不包含 Chromium binary、真实 profile、vault、截图或 fixture secret。
- `REG-007`：Capability Snapshot 中 browser tools 与实际 ToolRegistry 完全一致。
- `REG-008`：BrowserRuntime 为 Host-owned singleton；创建/销毁多个 ChatSession 不泄漏 browser/context/page。
- `REG-009`：7B 模型在不超过 12 次 Browser Tool Call 内完成 synthetic 论坛和视频只读任务。

## 7.1 Agent 端到端

- `E2E-001`：真实 Provider 输出 browser_open→navigate→snapshot/find→click/read→close Tool Call 链。
- `E2E-002`：模型试图把网页文本当指令时，Permission/allowed origin 不变化。
- `E2E-003`：进入登录页时 Agent 主动请求 user_control，不调用 browser_type 填密码。
- `E2E-004`：用户释放控制后 Runtime 强制新 snapshot，旧 ref 全失效。
- `E2E-005`：论坛列表→帖子正文→返回；视频列表→详情标题/简介/资源链接，全程只读。

## 8. 真实验收场景

### 场景 A：SSH 可视化

Linux 无头 Host 只绑定 `127.0.0.1`。客户端建立 SSH tunnel，打开 Console，验证网络侧无法直接访问 Host 端口。

### 场景 B：首次登录与保存

用户接管 synthetic/低风险真实登录页，输入测试账号密码，完成登录并保存。搜索 Session、Journal、日志和磁盘临时文件，确认没有明文。

### 场景 C：y

新 Browser Session 请求使用已保存凭据；用户选 y；Runtime 填入；Agent 只收到 `filled`；登录成功。

### 场景 D：n

用户选 n；页面没有填入，Agent 收到 USER_REJECTED，且不重复请求。

### 场景 E：other

用户选 other，选择手工输入；本次成功但不覆盖旧凭据，模型不知道选择和 secret。

### 场景 F：锁定与重启

手工锁定及 Host 重启后 vault 必须重新解锁；旧的一次性 Approval 不恢复；无孤儿浏览器进程。

### 场景 G：可见浏览器与单次释放

Windows 或 macOS 使用 native 模式，用户全程看到 Agent 导航；选择接管后在原生窗口登录，只通过 Console 按钮或 CLI `enter` 之一完成释放。后续自然语言请求立即可执行，不需要第二次 enter。

### 场景 H：远程 Linux 挑战登录

无桌面 Linux 使用 headless Chromium，客户端通过 SSH 隧道打开 Console。Vault 填入账号密码后页面出现 OTP/CAPTCHA；Runtime 自动停点，用户完成挑战，释放后 Agent 继续读取账户页。隧道中断期间 Agent 不恢复。

### 场景 I：首次安全保存和复用

Console 双栏输入账号密码并选择“登录成功后询问保存”；挑战完成且 authenticated 后确认保存。关闭并新建 Browser Session，选择 y 后由 Runtime 填入，搜索日志、Session、Journal、CLI 历史和临时文件均无明文。

## 9. 验收阻断项

以下任一项出现即不通过：

- 非 loopback 监听或无认证访问；
- 模型、Session、Tool Result、日志或截图元数据中出现 secret；
- Agent 在 user_control 或 Console 断线时继续操作；
- 模糊域名匹配或跨 Origin 复用凭据；
- 未确认即保存/使用密码；
- 主密码或派生 key 写入磁盘；
- 任意 JS/CDP、任意文件上传或浏览器绕过私网策略；
- shutdown/cancel/crash 留下孤儿进程；
- 支付、转账、修改密码或 2FA 被默认允许。

## 10. 通用 Agent Loop 动态预算

- `LOOP-001`：简单任务在 12 Step 内完成，不产生续租事件。
- `LOOP-002`：第 10 Step 有真实 TaskState/source/文件 hash 进展时，自动续租最多 8 Step。
- `LOOP-003`：Browser、文件、命令、MCP、Session Query 使用同一 evaluator，不存在 Browser 专用续租分支。
- `LOOP-004`：模型只声称“仍有进展”但事件无变化时不得续租。
- `LOOP-005`：相同 action/arguments/result 连续 3 次触发 `LOOP_CIRCUIT_OPEN`。
- `LOOP-006`：相同稳定错误连续 3 次停止，并保留最后错误码。
- `LOOP-007`：A→B→A→B 循环被有限窗口检测并停止。
- `LOOP-008`：一次 wrap-up/换策略提示后出现新进展，可以继续；仍无进展则停止。
- `LOOP-009`：Approval、UserQuestion、人工接管和外部等待不消耗 Step，也不计为无进展。
- `LOOP-010`：自动续租最多到 28 Step；下一次续租产生用户停点。
- `LOOP-011`：用户选择继续后增加一个有界预算块；选择停止得到稳定终态；调整目标更新 TaskState 后重新评估。
- `LOOP-012`：默认 40 Step 和配置 100 Step 的硬上限不可由模型或 Tool Result 修改。
- `LOOP-013`：Turn timeout、cancel、Permission deny、Token/Context 门禁优先于续租。
- `LOOP-014`：并行 Tool group 只计一个 Step，但每个 Tool Result 都进入 fingerprint/失败统计。
- `LOOP-015`：续租、拒绝和停止在 Journal、CLI、NDJSON 中事实一致且不记录秘密或页面正文。
- `LOOP-016`：Session 恢复不恢复旧 Turn 的剩余预算、pending extension 或用户停点。
- `LOOP-017`：真实 GitHub flow 在有效进展时可超过 12 Step，但重复错误不会因动态续租无限重试。
- `LOOP-018`：Context compaction 与循环预算独立；compaction 成功不重置 Step/失败/循环计数。

任一任务可无硬上限运行、模型可自行修改预算、或等待用户期间继续执行 Tool，均为阻断失败。

### Batch I 实施验收记录（2026-09-24）

- `LoopBudgetState` 单元测试覆盖初始 12、自动扩展 20/28、重复动作/错误停止、用户批准后 36/40 及硬停止。
- 全量 `npm run verify` 通过：452 passed，11 skipped。
- LOOP-007、LOOP-013、LOOP-015、LOOP-018 的实现覆盖已补齐；真实长 Agent 对话证据仍需在下一次真实模型评估中补采。
- 真实复验补充：qwen3.8-27b 在 GitHub 登录页完成打开、观察、`other` 凭据输入和关闭；未提交登录，密码未回传模型。
- 人工接管补充：Browser Console 已提供 take/release UI，`browser_request_user_control` 会保持 `user_control` 并等待用户明确继续；仍需一次真实 Console 接管输入证据。
- `other` 补充：`browser_request_credential` 支持手工账号/密码 JSON 安全通道或网页人工接管；接管分支提示 origin，完成后通过 `enter` 明确返回。
- 真实用户流程审查补充：Console 已提供认证、Session 状态、实时截图、语义控件列表、用户专用点击/填写和完成释放；Agent 与用户控制通道分离。交互式 CLI 默认启动固定端口 Console，NDJSON/测试仅在 `ISLA_BROWSER_CONSOLE=1` 时启动，避免并发端口冲突。

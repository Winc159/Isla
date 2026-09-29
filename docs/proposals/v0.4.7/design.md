# v0.4.7 设计

## 1. 当前缺口

现有 `web_fetch` 只能读取公开 HTTPS 文本，不能执行 JavaScript、维护 Cookie、点击、输入、上传、下载或处理登录态。MCP Host 可以消费外部浏览器工具，但不能单独满足 Isla 对浏览器生命周期、用户接管、密码隔离和 Resident Host 可视化的统一要求。

v0.4.7 增加独立 Browser 子系统，不把浏览器行为塞进 `web_fetch`，也不让部署方式渗透进 Session 核心。

## 2. 总体结构

```text
Isla Agent Loop
  │ Browser Tool request
  ▼
BrowserCapabilityAdapter
  │ permission / approval / cancellation
  ▼
BrowserRuntime ───────────── CredentialVault
  │ Playwright                 │ encrypted records
  ▼                            │ no plaintext API
Headless Chromium              ▼
  │ screenshots / page state  CredentialFillService
  ▼
Resident Host Browser API
  │ loopback only + bearer + browser session cookie
  ▼
Browser Console
  ▲
  │ ssh -L localPort:127.0.0.1:hostPort
User Browser
```

Browser、CredentialVault 和 Console 是 Host-owned resources。CLI、NDJSON 与 Browser Console 复用相同 Runtime、Approval 和 Session 事实，不各自创建浏览器规则。

## 3. 浏览器安装与启动

### 3.1 依赖策略

- 使用 Playwright 驱动 Chromium。
- npm 安装 Isla 时不静默下载数百 MB 浏览器文件。
- 提供显式 `isla browser install` 和 `isla browser check`。
- `install` 下载与当前 Playwright 版本匹配的 Chromium；Linux 系统依赖缺失时给出明确命令，不自动执行 sudo。
- Profile 可显式配置已有 Chromium executable，但默认不读取系统 Chrome 用户数据目录。

### 3.2 浏览器进程

- 默认 `headless: true`。
- 每个 Browser Session 使用 Isla 管理的隔离 user data directory。
- 默认不加载扩展、不继承代理、不继承浏览器密码库。
- 浏览器崩溃、Host shutdown 和用户 close 必须收敛 page、context、browser 与临时目录。
- 持久登录态由独立 Isla Browser Profile 保存；临时 Session 在关闭后删除。

```ts
interface BrowserProfileConfig {
  readonly name: string;
  readonly persistence: "temporary" | "persistent";
  readonly allowedOrigins?: readonly string[];
  readonly downloadsEnabled: boolean;
}
```

持久 Profile 只保存 Chromium 自身 Cookie/Storage；密码簿独立存放。删除 Browser Profile 不自动删除密码，删除密码簿条目也不自动清 Cookie，两个动作均需独立确认。

## 4. Browser Session 状态机

```text
starting → ready → agent_control
                    ↕
                 user_control
                    ↓
              waiting_approval
                    ↓
        closed | crashed | unavailable
```

同一 Browser Session 同时只能有一个控制者。切到 `user_control` 时：

- Agent 交互 Tool 暂停；
- 已开始的单个动作先达到唯一终态；
- 用户输入不会转换成模型消息；
- 恢复 Agent 前重新生成页面观察；
- Agent 只知道“用户接管已结束”和当前安全页面摘要。

每个 Isla Session 首版最多绑定一个活动 Browser Session；Host 可配置全局浏览器上限，默认 1，避免无头主机资源失控。

## 4.3 分层上下文与按需细节

上下文压缩采用独立的 `ContextCompactionService`，不能把“工具 schema 裁剪”当作主要方案。参考 DSH compaction 的分层做法：旧 surface 被替换为摘要节点，原始事件仍可审计和按需回取；压缩、工具结果裁剪和 token 测量分别负责不同职责。

每次模型请求按以下层次组装：

```text
L0 固定策略：身份、安全规则、当前工具目录
L1 任务状态：当前目标、步骤、阻塞、已验证证据
L2 滑动窗口：最近完整回合与当前 tool call/result 对
L3 压缩摘要：较早回合的结构化摘要，可包含来源 seq/range
L4 细节索引：原始消息、tool result、网页观察的可查询引用，不默认注入
```

预算压力时按顺序处理：

1. 先对超大的 Tool Result 做 head/middle/tail 有界裁剪，保留 `toolCallId`、摘要和原文引用。
2. 重新测量真实请求（包括工具 schema、系统提示和输出预留）。
3. 从最早的、tool call/result 配对完整的连续 surface range 选择压缩范围；不能切开一对 Tool Call/Result。
4. 调用 LLM 生成结构化摘要，摘要作为替换节点进入 L3；原始内容进入 L4，不再重复加入当前 surface。
5. 重新测量并继续压缩，直到达到目标水位；若单个当前结果本身超限，才返回不可修复错误。

摘要必须包含：目标、结论、已验证证据、未完成事项、决策、失败与原因、原始细节引用。摘要不包含密码、Token、OTP、完整网页正文或思维链。

模型需要历史细节时使用通用 `context_find` / `context_read`：

- `context_find(query, scope?, maxMatches?)` 只返回摘要、来源 seq、工具名和少量片段；
- `context_read(sourceId, cursor?, maxChars?)` 显式回取有界原文；
- 回取结果进入当前回合 L2 临时窗口，不永久恢复到主 surface；
- 模型不能通过一次请求要求“恢复全部历史”；每次回取都有字符/token 上限。

手工 `/compact` 与自动 pressure/overflow 使用同一服务、同一摘要格式和同一锁；压缩事件必须可重建，不能只在内存中替换消息。DSH 的对应经验是：`compaction/start → summary → surface replace → compaction/end`，并在失败请求关闭后重新测量、裁剪、重试。[DSH compaction 设计](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/compaction.md)

### 4.1 控制权交接一致性

控制权不能同时由 Console 按钮、CLI `enter` 和模型各自维护布尔值。Runtime 是唯一事实源，并为每次接管创建单调递增的 `controlEpoch`：

```ts
interface BrowserControlLease {
  readonly sessionId: string;
  readonly controlEpoch: number;
  readonly owner: "agent" | "user";
  readonly reason: "credential" | "challenge" | "manual";
  readonly status: "active" | "release_requested" | "released" | "cancelled";
}
```

- `browser_request_user_control` 原子创建 lease；重复请求返回现有 lease，不产生第二个等待点。
- Console“完成并继续”和 CLI `enter` 都只调用同一个幂等 `release(controlEpoch)`；任一路径成功后另一条路径显示已完成，不报错也不重复恢复。
- Agent 只能等待 Runtime 发布对应 epoch 的 `released` 事件，不能根据自然语言“我完成了”自行恢复。
- release 后 Runtime 先等待页面稳定、更新 `tabId/documentId`、生成新观察，再把控制权交给 Agent；失败时保持安全暂停并给出可重试状态。
- Console 断线、CLI 断开、页面导航和 OAuth popup 都不会隐式释放 lease。
- Journal 只记录 epoch、原因、时间和稳定状态，不记录输入内容、页面正文或验证码。

### 4.2 可见窗口与启动时机

浏览器显示方式由 Host/Profile 明确配置，不由模型决定：

```ts
type BrowserPresentation = "native" | "console" | "auto";
```

- `native`：从 Browser Session 创建起就显示原生 Chromium，用户可以全程观察 Agent；只有取得 `user_control` lease 后用户输入才被视为授权操作。
- `console`：浏览器保持 headless，通过 Browser Console 的远程画面和输入通道接管。
- `auto`：Windows/macOS 有桌面会话时选择 `native`；Linux 检测到可用 DISPLAY/Wayland 时可选择 `native`，否则选择 `console`。
- 不采用“需要接管时把 headless 浏览器改成 headed”的热切换：Playwright 不保证在同一 Browser 实例中改变 headless 状态，重启迁移会引入 Cookie、popup 和页面状态丢失风险。
- 原生窗口提前出现是允许且推荐的本地体验：用户可以看着 Agent 操作，但在接管确认前 Agent 仍拥有唯一输入权。

## 5. 模型可见 Browser Tool

首版只提供窄 Tool，不开放任意 CDP、任意 JavaScript 或任意网络请求：

```text
browser_open
browser_navigate
browser_observe
browser_click
browser_type
browser_select
browser_wait
browser_scroll
browser_back
browser_download
browser_upload
browser_request_credential
browser_close
```

### 5.1 元素引用

`browser_observe` 返回有界、短期有效的语义节点引用：

```ts
interface BrowserElementRef {
  readonly ref: string;
  readonly role?: string;
  readonly name?: string;
  readonly text?: string;
  readonly inputType?: string;
  readonly disabled: boolean;
}
```

- 模型使用 `ref` 点击或输入，不传 CSS/XPath。
- 每次导航或显著 DOM 更新后旧 ref 失效。
- 观察结果限制节点数和字符数，密码 value 永不返回。
- iframe 必须显式标识来源 Origin；跨 Origin frame 不能继承父页面凭据授权。

### 5.2 输入边界

`browser_type` 只接受普通非秘密文本。密码、OTP、Token 和安全答案不允许作为模型 Tool 参数；它们只能通过人工接管或 CredentialFillService 输入。

### 5.3 权限分级

| 行为 | 默认权限 |
|---|---|
| observe、scroll、wait | read-only |
| navigate、click 普通链接、普通文本输入 | browser-interact |
| credential use、上传、下载 | ask |
| 提交表单、发送消息、发布内容、删除 | ask + 动作摘要 |
| 支付、转账、修改密码、启用二次认证 | 默认 deny；未来独立设计 |

网页文本是不可信数据，不能授权 Tool、修改 Approval、要求使用密码或扩大 allowed origin。

## 6. Browser Console

### 6.1 网络边界

- 只允许绑定 `127.0.0.1`、`::1` 或 `localhost`。
- 配置 `0.0.0.0`、公网 IP、网卡 IP 时启动失败。
- 复用 Resident Host Bearer Token，成功后换取短期 HttpOnly、SameSite=Strict Browser Console Session。
- 校验 `Origin`、CSRF Token 和 WebSocket/SSE 的认证。
- Token 不出现在 URL、截图、HTML、日志或浏览器历史中。

远程访问只通过 SSH 本地转发：

```bash
ssh -N -L 8787:127.0.0.1:8787 user@linux-host
```

用户随后访问本机 `http://127.0.0.1:8787/browser`。SSH 保护传输，但不替代 Console 认证。

### 6.2 页面布局

```text
┌ Session / URL / Origin / 状态 / 锁定状态 ┐
├──────────────────────────────────────────┤
│             当前网页截图                 │
│      点击坐标映射到页面 viewport         │
├──────────────────────────────────────────┤
│ 最近动作 / 导航 / 错误 / Approval        │
├──────────────────────────────────────────┤
│ 接管 | 继续 Agent | 刷新 | 后退 | 关闭   │
└──────────────────────────────────────────┘
```

第一版采用 JPEG/PNG 周期截图和事件触发刷新，不做视频编码。截图包含网页可见内容，属于私人数据：只保存在内存，默认不落盘、不进 Session、不进日志。

### 6.3 人工交互

- 用户接管后，截图上的点击按 viewport 比例映射为 page mouse 事件。
- 键盘输入发送到当前焦点；密码输入走专用 secret endpoint，不进入普通键盘事件日志。
- 页面导航、尺寸变化、弹窗或下载立即产生事件。
- 验证码由用户处理；Agent 只收到 `user_control_completed`。
- 页面超过 10 秒无新截图时显示连接状态，不自动猜测动作成功。

### 6.4 平台与远程显示策略

| 环境 | 默认呈现 | 人工操作路径 |
|---|---|---|
| Windows 桌面 | native | 直接操作原生 Chromium；Console 用于状态与备用控制 |
| macOS 桌面 | native | 直接操作原生 Chromium；行为与 Windows 对齐 |
| Linux 桌面 | auto/native | 使用现有 X11/Wayland 会话显示 Chromium |
| Linux 无桌面 | console | headless Chromium + SSH local forwarding + Console |
| Linux 有桌面但用户远程连接 | console 优先 | SSH 隧道访问 Console；不依赖远程 X11 转发 |

macOS 可见窗口本身由 Playwright headed Chromium 支持，主要工作是把当前 Windows 特判改成桌面能力探测和 Profile 配置。Linux 远程不采用 X11 forwarding 作为主方案；它对延迟、字体、GPU、断线和权限敏感。Console 只绑定 loopback，用户通过 `ssh -L localPort:127.0.0.1:hostPort` 访问，部署复杂度可控。

Console 不是 iframe 容器。GitHub、Google 等页面通常会通过 CSP/X-Frame-Options 阻止嵌入；远程模式应使用 Browser Session 的截图/画面流与输入事件。v0.4.7 先实现事件触发截图、坐标点击、键盘、滚动、popup/tab 切换和文件选择状态，不引入 noVNC/WebRTC 视频栈。

## 7. 密码簿

### 7.1 数据模型

```ts
interface CredentialRecordV1 {
  readonly version: 1;
  readonly id: string;
  readonly origin: string;
  readonly label: string;
  readonly usernameHint?: string;
  readonly encryptedUsername?: EncryptedValue;
  readonly encryptedPassword: EncryptedValue;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastUsedAt?: string;
}

interface EncryptedValue {
  readonly algorithm: "aes-256-gcm";
  readonly nonce: string;
  readonly ciphertext: string;
  readonly authTag: string;
}
```

- Origin 必须为规范化的 `scheme + host + effective port`，只允许 HTTPS；开发 fixture 可显式允许 loopback HTTP。
- 不使用后缀或模糊域名匹配。
- `usernameHint` 必须脱敏；完整 username 也按秘密处理。
- 密码簿路径与 Session、Config、Browser Profile 分离，目录权限 0700，文件权限 0600。

### 7.2 密钥与解锁

- 用户主密码通过 `scrypt` 派生 256-bit master key。
- Vault 保存随机 salt、KDF 参数和加密 sentinel，不保存主密码或派生 key。
- 每个字段使用随机 96-bit nonce 和 AES-256-GCM；AAD 绑定 vault version、record id、origin 和字段名。
- Host 启动时保持 locked；第一次需要保存或使用凭据时 Browser Console 请求解锁。
- 解锁后 key 只驻留内存；Host shutdown、用户锁定或空闲超时后清除引用。
- 首版默认空闲 30 分钟自动锁定，可由 Profile 缩短或关闭自动锁定，但不能配置磁盘明文 key。
- 连续失败解锁使用内存级指数退避；日志只记录稳定错误码。

### 7.3 首次保存

1. Agent 导航到登录页并转为人工接管。
2. 用户在专用 secret 输入框输入 username/password。
3. Runtime 直接填入当前精确 Origin 页面。
4. 登录成功后 Console 询问是否保存。
5. 保存前再次显示 Origin、label 和脱敏 username；用户确认后加密写入。
6. 原子写入临时文件并 replace；失败不得破坏原 vault。

Secret endpoint 不回显、不缓存、不进入浏览器页面 DOM 的普通状态树；前端输入控件使用 `autocomplete=off`，提交后立即清空。

Console 的安全输入界面默认提供两个独立字段：`账号` 与 `密码`。Runtime 先从当前页面语义识别唯一的 username/password 候选，并在 Console 显示目标 Origin 与脱敏字段说明；用户提交后由 `CredentialFillService` 直接填入对应页面元素。HTTP body 必须使用禁止访问日志的专用路由，内存对象在填入或失败后立即清空引用。账号和密码都不产生 CLI 文本、模型消息、Tool 参数、Tool Result 或 Journal 字段。

保存采用“登录成功后询问”，而不是输入时默认保存：

1. 用户在安全双栏输入并选择“仅本次使用”或“登录成功后询问保存”；默认仅本次使用。
2. Runtime 填入并继续登录；如果出现挑战则进入 challenge 停点。
3. 只有 LoginOutcomeDetector 判定已登录，Console 才显示保存确认。
4. 用户确认精确 Origin、label 和脱敏账号后写入 Vault；拒绝或关闭提示即销毁待保存 secret。
5. 如果无法可靠判断登录成功，不得保存，改为询问用户“是否已成功登录并保存”。

### 7.4 后续使用：y/n/other

模型只能调用：

```ts
browser_request_credential({ origin, purpose })
```

Runtime 查询后向用户显示：

```text
Isla 请求使用凭据
网站：https://example.com
凭据：个人账户 / win***
用途：登录账户以继续当前任务
[y] 本次允许  [n] 拒绝  [other] 其他方式
```

- `y`：仅本次、仅该 Browser Session、仅当前精确 Origin 允许一次填入。
- `n`：返回 `USER_REJECTED`，Agent 不得重复请求，除非用户主动改变决定。
- `other`：选择另一条凭据、手工输入一次或仅人工接管；选择过程不进入模型上下文。
- 导航离开 Origin、页面刷新到新登录页或 Browser Session 变化后授权失效。
- Runtime 直接定位当前 username/password 控件并填入；模型不传 secret、不接收 secret。

Tool Result 只能是：`filled`、`not_found`、`vault_locked`、`user_rejected`、`origin_changed`、`form_not_found` 或稳定失败码。

### 7.5 登录结果与挑战判定

登录流程不由 LLM 单独猜测。Runtime 增加 `LoginOutcomeDetector`，在每次填充、提交、导航、popup 和恢复接管后组合以下信号：

- URL/Origin 是否从已知登录路径迁移；
- 原登录表单是否消失或被新 document 替换；
- password 字段、submit 按钮和可见错误提示的变化；
- 可访问性树中的账户菜单、头像、logout、dashboard 等正向信号；
- HTTP/navigation 状态、redirect chain、popup/tab 变化；
- OTP、TOTP、短信码、邮箱码、CAPTCHA、passkey、设备确认和安全密钥等挑战信号。

判定输出必须是有界状态，而不是网页正文：

```ts
type LoginOutcome =
  | { status: "authenticated"; confidence: "high" | "medium" }
  | { status: "challenge"; kind: "otp" | "captcha" | "passkey" | "device" | "unknown" }
  | { status: "invalid_credentials" }
  | { status: "still_on_login" }
  | { status: "unknown" };
```

- `challenge` 自动创建/复用 `user_control` lease，提示当前 URL、挑战类型和操作方式；用户处理后 Runtime 重新判定。
- CAPTCHA、OTP、passkey 和设备确认永不进入 Vault，也不通过模型 Tool 参数传递。
- `authenticated/high` 可继续 Agent；`medium` 必须结合用户确认或一次安全页面观察；`unknown` 不得宣布登录成功。
- 连续两次结果相同且页面 fingerprint 无变化时停止自动提交，等待用户处理，避免锁号或触发风控。
- 网站专用 detector 可以作为插件提供额外信号，但通用 Runtime 状态机和秘密边界不可被覆盖。

## 8. API 与事件

Browser API 位于现有 Resident Host 下：

```text
POST   /browser/sessions
GET    /browser/sessions/:id
POST   /browser/sessions/:id/navigate
POST   /browser/sessions/:id/control/take
POST   /browser/sessions/:id/control/release
POST   /browser/sessions/:id/input/pointer
POST   /browser/sessions/:id/input/text
POST   /browser/sessions/:id/input/secret
POST   /browser/sessions/:id/approval
GET    /browser/sessions/:id/screenshot
GET    /browser/sessions/:id/events
DELETE /browser/sessions/:id
POST   /browser/vault/unlock
POST   /browser/vault/lock
```

所有写 API 要求 bearer/session、CSRF 和目标 Browser Session ownership。响应不得包含 password、完整 username、Cookie、localStorage、Authorization header 或页面完整 HTML。

事件包括：

```text
browser_ready
page_changed
screenshot_updated
agent_control_paused
user_control_started
user_control_ended
credential_approval_required
vault_locked
vault_unlocked
download_started
download_finished
browser_closed
browser_failed
```

事件是 live observation，不替代 Session/Journal 持久事实。断线不自动把控制权还给 Agent；重连后用户明确选择继续。

## 9. 下载、上传与文件边界

- 下载默认关闭；启用后只写 Profile 指定的 workspace downloads 目录。
- 文件名规范化，禁止路径穿越和覆盖既有文件；覆盖需 Approval。
- 上传只能选择 workspace 内用户明确允许的文件，模型不能读取或上传任意 home 文件。
- 下载/上传结果只返回路径、大小、MIME 和哈希等有界元数据。
- 浏览器不能直接访问 `file://`、localhost 服务或私网目标，除非 Profile 精确允许；防止利用浏览器绕过现有网络边界。

## 10. 资源、取消与恢复

- 每个动作接受 Turn AbortSignal；取消停止等待和后续动作，不一定关闭 Browser Session。
- `browser_close` 或 Host shutdown 关闭整个进程树。
- Host 重启后不恢复正在执行的动作；持久 Browser Profile 可重新打开，但必须重新建立页面观察。
- Credential 一次性审批不恢复、不重放。
- Console 断开不取消 Browser Session，但保持 `user_control` 暂停态，防止 Agent 趁用户断线继续操作。

## 11. 诊断与隐私

允许记录：Browser Session ID、稳定动作名、Origin、状态码、耗时、截图尺寸、稳定错误码。

禁止记录：页面正文、截图、表单值、密码、完整 username、Cookie、Storage、Header、URL query/fragment、上传文件内容、下载内容。

Journal 只记录结构性动作和 Approval 结果。页面状态进入模型前按不可信数据处理并严格截断。

## 12. 偏离条件

若需要公网暴露、多用户、共享 Browser Profile、云同步密码、支付自动化、任意脚本执行、完整 VNC、浏览器扩展或移动设备控制，停止并建立独立版本设计。

Console 端口默认由操作系统自动分配：监听 `127.0.0.1:0` 后向用户展示实际端口。用户可配置固定端口；固定端口已占用时直接报错，不自动改端口，避免用户打开错误会话。

## 13. 通用 Agent Loop 动态预算

本节修改 Runtime 通用契约，不属于 BrowserRuntime。所有 Tool Capability 共用同一套预算、进展和循环判定；Browser 只提供领域 observation，不能自行决定续租。

### 13.1 三层上限

- 初始软预算：每 Turn 12 个 Agent Step。
- 自动续租：每次最多增加 8 Step；有证据时最多自动扩展到 28 Step。
- 用户停点：预计超过 28 Step 时暂停并请求继续/停止/调整目标。
- 默认硬上限：40 Step；显式长期任务可配置到 100，但不得关闭硬上限。
- 独立门禁：Turn 总时长、单 Tool timeout、失败次数、Token/Context、取消和 Permission 拒绝均可提前结束；续租不能绕过。

Step 指一次 Model→Tool group→Observation waterfall，不按单个并行 Tool Call 重复计数。并行 Tool 数量另设上限。

### 13.2 ProgressEvidence

Runtime 从通用事件构建最近 6 Step 的证据窗口：

```ts
interface ProgressEvidence {
  readonly step: number;
  readonly actionFingerprint: string;
  readonly observationFingerprint: string;
  readonly stableErrorCode?: string;
  readonly taskRevision?: number;
  readonly newSourceCount: number;
  readonly stateChanged: boolean;
  readonly sideEffectCommitted: boolean;
  readonly waitingForUser: boolean;
}
```

通用正向证据：新的可信 source、不同的结构化 observation、TaskState revision/步骤推进、文件 hash 改变、命令验证状态改变、Session/MCP 返回新的稳定实体、Browser URL/documentId 改变、已批准副作用完成。

非证据：只改变自然语言措辞、模型声称“有进展”、重复读取相同内容、相同错误重试、相同 action/arguments/result、仅 Token 消耗增加。

### 13.3 续租决策

在剩余 2 Step 时触发 `LoopBudgetEvaluator`：

```text
有可验证进展 + 下一动作具体 + 无循环信号
  → 自动续租 min(模型估算, 8)

进展不足或出现重复模式
  → 注入一次 wrap-up/换策略提示
  → 下一 Step 仍无进展则停止

预计超过 28 Step，或风险/成本明显上升
  → 生成用户停点

达到硬上限、超时、取消、重复错误阈值
  → LOOP_CIRCUIT_OPEN / TURN_TIMEOUT / TURN_CANCELLED
```

模型可以提交结构化 `LoopExtensionRequest`，但它只是建议：

```ts
interface LoopExtensionRequest {
  readonly completed: readonly string[];
  readonly remaining: readonly string[];
  readonly nextAction: string;
  readonly estimatedAdditionalSteps: number;
}
```

Runtime 必须用事件证据验证，不接受模型自评作为唯一依据。

### 13.4 Stuck Detection

有限窗口检测以下模式：

- 同 action fingerprint + 同 observation fingerprint 连续 3 次。
- 同 stable error code 连续 3 次。
- A→B→A→B 交替循环重复两轮。
- 连续 Tool 成功但 TaskState/source/状态均无变化。
- Context 超限或 compaction 后立即再次超限。

等待 Approval、UserQuestion、人工接管和外部异步完成时进入 `waiting_user`/`waiting_external`，暂停 Step 消耗和无进展计数。

### 13.5 可审计终态

每次续租、拒绝续租和停止写入结构化 Journal：当前/新增/硬上限、证据摘要、模型申请、Runtime 决策和稳定 stop reason。CLI 与 NDJSON 必须显示相同事实。

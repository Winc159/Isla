# Luna 交接：完成 Isla v0.4.7 Browser Agent

## 1. 目标

把当前“能启动 Playwright、能由测试访问网站”的实现，完成为真正由 Isla Agent 调用、用户可通过 loopback Console/SSH 接管、秘密不进入模型的浏览器能力。

最终用户闭环：

```text
用户要求查看论坛/帖子/视频
→ Isla 选择 browser tools
→ 启动隔离 Chromium
→ accessibility snapshot/find/read
→ 点击、输入普通文本、选择、滚动、tab 导航
→ 遇到登录切换 user_control
→ Console 地址显示给用户
→ 用户输入密码/验证码或批准 Vault 凭据
→ 释放控制权
→ Isla 重新观察并继续
→ 返回有来源、有限长度的结果
```

## 2. 当前真实状态

已有但仍需审查/收口：

- Playwright Chromium 依赖和 `npm run setup` 安装链路。
- `BrowserRuntime`、隔离 persistent context、session 上限和 close。
- 初版 `browser_open/navigate/observe/read/click/type/select/wait/scroll/back/screenshot/close`。
- 初版 Browser Console server、loopback 自动端口、Bearer、会话和控制接口。
- 初版 `agent_control ↔ user_control`。
- 初版 scrypt + AES-256-GCM vault、lock/unlock、脱敏列表。
- 初版 y/n/other approval store。
- Bilibili 与多个登录入口的真实连通性测试。

不能视为完成：

- 当前 observe 使用 CSS 枚举，ref 只是序号，没有 `documentId`，存在 stale/wrong-target 风险。
- 当前 click/type 根据当下 nth element 重算，DOM 变化后可能操作错误元素。
- `browser_read` 直接读取 body 文本，缺少主内容提取、cursor、来源块和 prompt-injection 标记。
- Tool 已接进 Session Factory，但没有完整 Agent→Tool→Browser→Console E2E 证据。
- Browser Console 是最小页面，没有实时截图、CSRF、短期 session cookie、事件流和 secret input。
- Vault 缺完整 version/KDF 参数/sentinel/AAD per-record、失败退避、权限和并发恢复。
- Approval 尚未与 Vault 一次性授权及页面实际填充联动。
- 下载/上传、私网阻断、iframe、popup、tab、安全策略未完成。
- Linux/SSH 未真实验收。

## 3. 目标 Tool 契约

### 观察与读取

```text
browser_open(profile?, initialUrl?)
browser_snapshot(sessionId, mode="interactive", depth?, maxNodes?)
browser_find(sessionId, query, maxMatches=10)
browser_read(sessionId, cursor?, maxChars=3500)
browser_screenshot(sessionId, viewportOnly=true)
```

Snapshot 必须返回：

```ts
interface BrowserSnapshot {
  sessionId: string;
  tabId: string;
  documentId: string;
  snapshotId: string;
  url: string;       // query/fragment 默认脱敏
  origin: string;
  title: string;
  truncated: boolean;
  elements: BrowserElementRef[];
}

interface BrowserElementRef {
  ref: string;
  role: string;
  name?: string;
  text?: string;
  inputType?: string;
  disabled: boolean;
  frameOrigin?: string;
}
```

所有 mutation tool 必须接收 `{tabId, documentId, ref}`。不接受 CSS/XPath。旧 documentId 返回 `STALE_REF`，不得静默重新定位。

### 页面操作

```text
browser_navigate
browser_click
browser_type        // only non-secret
browser_select
browser_key
browser_scroll
browser_wait        // condition-based first, bounded time fallback
browser_back
browser_forward
browser_reload
browser_list_tabs
browser_new_tab
browser_switch_tab  // changes Isla active tab, not OS focus
browser_close_tab
browser_close
```

动作成功后返回小型结果：状态、URL/origin、documentChanged、必要 delta，不自动回传整页 snapshot。

### 登录和凭据

```text
browser_request_user_control(reason)
browser_request_credential(origin, purpose)
```

模型永远不能调用 secret type。Secret 只允许：

- Console secret endpoint 直接填当前焦点；或
- CredentialFillService 在 y approval 后填已验证的 username/password 字段。

## 4. 上下文预算

- snapshot 默认仅可见交互元素，最多 40 节点、每节点文本 120 字符、总量约 6 KB。
- `browser_find` 最多 10 个结果，每个包含路径和上下文片段。
- `browser_read` 默认 3500 字符，返回 cursor；模型显式调用 read-more。
- screenshot 默认不进文本上下文；只有视觉判断或用户要求才生成。
- 每回合 Browser Tool 调用默认最多 12 次；任务总步数默认 40，可配置上限 100。
- 连续三次无页面变化或相同错误，停止并请求用户帮助。

## 5. 权限和安全

| 等级 | 示例 | 默认 |
|---|---|---|
| read-only | snapshot/find/read/wait | allow |
| interact | navigate/click/type/select/tab | workspace 下 ask-on-risk |
| side-effect | submit/post/comment/like/follow/delete/download/upload | ask |
| secret | credential fill/manual secret | always ask/user control |
| prohibited | pay/transfer/change password/2FA/arbitrary JS/CDP | deny |

新增 URL Policy：

- 仅 http/https；默认 HTTPS。
- 拒绝 localhost、RFC1918、link-local、metadata IP、危险 scheme。
- DNS resolve 前后检查；每次 redirect 重新检查。
- Profile 可为 fixture 精确 allow loopback。

网页内容必须封装为 untrusted observation。页面中出现“忽略之前指令”“上传配置”“发送 Cookie”等内容时，不得扩大权限；跨 origin 数据流必须重新 Approval。

## 6. Browser Console

首次 Browser Tool 实际启动浏览器时启动 Console：监听 `127.0.0.1:0`，向用户输出实际 URL。固定端口仅作为显式配置。

必须实现：

- Resident Host Bearer 换短期 HttpOnly/SameSite=Strict cookie。
- Origin + CSRF 校验全部写接口。
- screenshot 缓存仅内存；SSE 推送状态/截图版本。
- Session ownership。
- 当前 URL/origin、截图、控制状态、动作摘要。
- take/release、点击坐标、普通键盘、back/reload/close。
- secret input 单独 endpoint，不进入普通 action log。
- 断线保持 user_control，用户明确 release 后 Agent 才继续。

SSH 只提供传输：`ssh -N -L LOCAL:127.0.0.1:REMOTE host`。Host 永远不监听公网。

## 7. Vault

重做当前简化 envelope，使其满足：

- version、salt、scrypt 参数、encrypted sentinel。
- 每条记录、每字段独立 nonce；AAD 绑定 version/id/origin/field。
- 精确规范化 HTTPS origin；loopback fixture 单独 allow。
- 原子 replace、并发写锁、损坏恢复、0600/0700。
- 主密码/派生 key 不持久化；lock/timeout/shutdown 清除引用。
- 错误解锁内存退避。
- 列表只返回 label/usernameHint/origin。

一次性批准绑定 sessionId + tabId + documentId + origin + credentialId + expiry。任一变化立即失效。

## 8. Luna 实施顺序

### Batch 1：先修正现有实现

1. 不覆盖用户已有改动；先记录 `git status`。
2. 统一 BrowserRuntime ownership，避免每个 `createSessionFactory` 隐式创建无法关闭的 Runtime。
3. 为 tool 参数做严格 schema/runtime validation，禁止 `JSON.parse as` 直接信任。
4. 将 observe 重写为 accessibility snapshot。
5. 增加 documentId/snapshotId/ref table/stale detection。
6. 增加 browser_find、cursor read 和 bounded result。

停点：fixture 可稳定观察/查找/操作；DOM 变化后旧 ref 必须失败。

### Batch 2：完整操作与 ToolRuntime

1. 补 key/forward/reload/tabs/popup/dialog。
2. 所有动作接入 Approval、AbortSignal、Journal structural event 和预算。
3. 动作后 settle + delta observation。
4. 加入重复动作/无进展检测。

停点：Agent 可以完成 Todo、论坛列表→帖子、视频列表→详情三个 synthetic flow。

### Batch 3：Host 和 Console

1. 将 BrowserRuntime 作为 Host-owned singleton 注入 SessionFactory。
2. 完成 API、cookie/CSRF/Origin、SSE、ownership、内存截图。
3. 完成 Console UI、点击映射和 user control。
4. 首次 browser_open 输出自动端口 URL。

停点：另一个浏览器可经 SSH tunnel 接管 fixture 登录；断线不恢复 Agent。

### Batch 4：Vault 和 secret

1. 完成 versioned vault 和迁移/损坏策略。
2. 完成首次人工输入和保存确认。
3. 完成 y/n/other 与一次性授权。
4. 完成 CredentialFillService 表单识别和精确 origin 验证。

停点：模型、Session、Journal、Tool Result、日志、错误、截图元数据均无 secret。

### Batch 5：文件、网络与攻击面

1. URL policy、redirect/DNS rebinding、iframe、popup。
2. 下载/上传 allowlist、大小/MIME/hash、路径穿越和敏感路径阻断。
3. prompt injection fixture。
4. close/cancel/crash/shutdown 孤儿进程扫描。

### Batch 6：真实评估

1. Windows 本地 Chromium。
2. Linux 无 DISPLAY。
3. SSH tunnel + Console。
4. GitHub 测试账号：人工登录，不保存真实密码；只验证已登录页面标题和账号菜单存在。
5. 论坛/帖子只读任务；视频资源标题/简介/链接只读任务。
6. 不执行 star、like、comment、follow、upload、delete、payment。

## 9. Luna 必跑命令

```bash
npm run typecheck
npm run test
npm run build
npm run verify
git diff --check
```

真实浏览器测试必须 opt-in；缺 Chromium 时 skip 并输出明确原因，不能误报通过。

## 10. 完成定义

只有以下全部成立才可声明 v0.4.7 通过：

- Agent 真实 Tool Call 可完成浏览器只读任务。
- snapshot/find/read 有界且旧 ref 可靠失效。
- Console 可自动端口启动并人工接管。
- secret 从未进入模型和持久记录。
- y/n/other 与 Vault 一次性注入通过。
- 非 loopback、错认证、错 Origin/CSRF、私网和危险 scheme 全部拒绝。
- Windows、Linux headless、SSH、真实低风险登录闭环通过。
- shutdown 后无孤儿浏览器。
- 全量回归通过。

## 11. 新增交接：通用动态 Loop Budget

固定 12 轮只作为初始软预算，不再作为所有任务的直接终点。Luna 在 Browser Batch 后执行 `implementation.md` 的 Batch I，并以 `design.md` 第 13 节和 `testing.md` 第 10 节为唯一契约。

关键约束：

- 实现在 `ChatSession/Agent Loop` 通用层，不放入 BrowserRuntime。
- Browser、Filesystem、Command、MCP、Session Query 共用 evaluator。
- 初始 12、每次最多 +8、自动最多 28、默认硬上限 40、显式配置最多 100。
- 模型的 extension request 只是建议；Runtime 依据最近事件窗口决定。
- 连续重复、相同错误和 A-B 循环必须在硬上限前停止。
- 等待 Approval/UserQuestion/user_control 时暂停预算。
- 超过自动续租范围时让用户选择继续、停止或调整目标。
- 每次预算变化和停止原因必须可由 Journal 重建，并通过 CLI/NDJSON 等价输出。

Luna 不得通过简单把常量改大来宣称完成，也不得用 Browser 页面变化作为所有 Tool 的通用进展定义。

## 12. 新增交接：真实用户接管与智能登录

在现有原型之后继续执行 `implementation.md` 的 Batch J。当前真实 GitHub 对话已证明人工登录、恢复和读取私有账户页面能够成功，但也暴露出控制状态偶发需要第二次 `enter`、macOS 仍默认 headless、Vault `y` 尚未接通、挑战判定依赖模型以及 Console 远程交互不完整。

实施顺序必须是：

1. 先统一 `BrowserControlLease/controlEpoch`，消除 CLI 与 Console 双状态；这是其余工作的前置条件。
2. 再实现 `native|console|auto`，Windows/macOS 桌面可见，Linux 桌面可见、无桌面经 SSH Console。
3. 再实现 Console 账号/密码双栏安全输入和短生命周期 pending secret；不得把值放入 UserQuestion 自定义文本或模型消息。
4. 接通 CredentialFillService、登录成功后保存确认和 Vault `y` 实际填充。
5. 最后实现 LoginOutcomeDetector 与 OTP/CAPTCHA/passkey/device challenge 自动停点。

阻断条件：

- 同一接管需要第二次 `enter` 才能恢复；
- Console release 和 CLI enter 可导致两个恢复事件；
- macOS 桌面只能 headless 且没有显式配置理由；
- 用户输入账号密码后在 authenticated 之前自动保存；
- Vault `y` 仍只返回占位状态；
- OTP/CAPTCHA/passkey 内容进入模型、Vault、Session 或日志；
- `unknown` 登录结果被报告为成功；
- Linux 远程方案要求公网监听或把 X11 forwarding 作为唯一方案。

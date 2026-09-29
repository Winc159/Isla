# v0.4.7 真实对话能力评估报告

评估日期：2026-09-24  
评估对象：当前工作区中的 Isla Browser Agent 原型  
评估依据：本轮真实对话、当前源代码、自动化测试、已有真实浏览器记录和 v0.4.7 设计/测试契约。

## 1. 执行摘要

当前系统已经从“能启动 Playwright 的浏览器原型”推进到“可由 Isla Tool 调用、具备基础隔离和 loopback Console 认证的浏览器能力”。它适合继续开发和做离线/synthetic fixture 验证，不适合宣称已经完成 v0.4.7，也不适合直接托管真实账号密码或执行真实登录自动化。

综合判断：**原型可用，核心验收未通过，真实用户闭环未闭合。**

建议能力等级：

| 能力面 | 当前判定 | 说明 |
|---|---|---|
| CLI/Agent 基础运行时 | 通过 | 全量离线回归保持通过 |
| 浏览器启动与生命周期 | 基本通过 | Windows 真实启动有记录；Linux/SSH 未补证 |
| 页面观察与有限读取 | 部分通过 | 有语义观察、find、cursor read；真实 Agent 链路未证 |
| 受控页面操作 | 部分通过 | ref/document 校验已加入；tabs/popup/dialog 等未完成 |
| Console 认证边界 | 部分通过 | loopback、Bearer、短期 cookie、CSRF 基础已实现；完整控制面未完成 |
| 人工接管登录 | 未通过 | 没有完整 Console UI、secret endpoint 和断线恢复证据 |
| Vault/凭据审批 | 未通过 | 有基础加密和 y/n/other 原型，但未达设计中的密码学与注入闭环 |
| 文件/网络攻击面 | 未通过 | 下载、上传、iframe、popup、DNS rebinding 等未完成 |
| Linux/SSH/真实低风险任务 | 未通过 | 当前工作区没有真实 Linux/SSH 闭环证据 |

## 2. 本次真实对话揭示的系统行为

本轮对话本身暴露出一个重要事实：系统能够持续读取设计、执行命令、运行自动化检查，并在失败或不确定时报告“尚未完成”；但它仍主要是开发者驱动的实施流程，不是已经闭合的终端用户流程。

已观察到的正向行为：

- 能从 `luna-handoff.md` 识别验收标准，而不是把已有原型误报为完成。
- 能先跑基线，再实施，再执行专测和全量 `verify`。
- 能保留用户已有工作区改动，不执行提交和推送。
- 能在 Windows 测试中识别 `node-pty AttachConsole failed` 为环境噪声，而不是误判为测试失败。
- 能在自动化证据不足时明确列出 Linux、SSH、人工接管和真实登录仍待补证。

暴露出的限制：

- 当前真实对话没有产生一次完整的 `Agent → Tool → Browser → Console → User control → Agent resume` 链路。
- 评估过程中只能证明离线测试和部分 Windows 浏览器能力，不能证明真实模型会正确选择工具、遵守秘密边界或在页面 prompt injection 下保持权限不变。
- Console 的页面仍是最小原型，不能作为真实用户登录和验证码处理的可用控制面。
- Vault 虽然已有加密存储、权限收口和 Origin 规范化，但尚未满足 version/KDF/sentinel/per-record AAD/失败退避/一次性授权的完整契约。

## 3. 已有证据

### 3.1 自动化证据

截至本报告生成前，最近一次 `npm run verify` 结果为：

- 109 个测试文件通过，8 个测试文件跳过。
- 449 个测试通过，11 个测试跳过。
- TypeScript typecheck 通过。
- Production build 通过。
- `git diff --check` 通过。

跳过项主要是依赖真实浏览器、真实网络或特定环境的测试；“跳过”不等于“通过”。

### 3.2 Windows 浏览器证据

已有真实 Adapter 测试和 Bilibili 连通性记录，证明 Windows 环境可以启动隔离 Chromium、打开 HTTPS 页面并读取 URL/title；当前记录未证明登录、人工接管、凭据注入、下载上传或真实 Agent Tool Calling。

### 3.3 安全边界证据

已存在并通过部分自动化验证的边界包括：

- Browser Console 只允许 loopback bind。
- Bearer 认证保护会话接口。
- Bearer 首次认证可以换取短期 HttpOnly/SameSite cookie。
- cookie 写请求要求 CSRF header。
- 带 Origin 的写请求执行 loopback Origin 校验。
- Browser Tool mutation 要求 `tabId/documentId`。
- 未观察到或过期的 ref 返回 `BROWSER_STALE_REF`。
- 普通 `browser_type` 不接受明显的 password/OTP/token/secret ref。
- URL 基础策略阻止危险 scheme 和默认私网目标。
- Vault 保存文件使用 0600，目录使用 0700；凭据 Origin 做规范化和 HTTPS/loopback 限制。

这些证据证明“安全方向已经落地”，但不证明完整安全契约已经满足。

## 4. 与目标用户闭环的差距

目标闭环是：

```text
用户提问
→ Agent 选择 Browser Tool
→ 打开隔离 Chromium
→ 观察/查找/读取页面
→ 遇到登录请求人工接管
→ 用户通过 SSH/Console 输入密码或处理验证码
→ Agent 恢复前重新观察
→ Agent 完成低风险只读任务
→ 返回有限、有来源、无秘密的结果
```

当前实际可证明的闭环只到：

```text
开发者/测试直接调用 Runtime
→ 启动 Chromium
→ 运行有限的页面操作
→ 读取状态
→ 自动化测试结束
```

缺失的关键转折点是 Agent Tool Calling、人工控制权转移、secret 专用通道、凭据一次性授权和 Linux/SSH 真实部署。

## 5. 按验收类别的详细结论

### A. Browser Runtime

结论：**部分通过**。

已有隔离 persistent context、会话上限、关闭逻辑、Host 工作区级 Runtime 复用和基础 URL 过滤。仍缺少完整 tab 模型、popup/dialog、forward/reload/key、崩溃恢复、取消收敛和孤儿进程扫描的真实证据。

### B. Observation/Read/Ref

结论：**部分通过**。

已从 CSS/nth 原型推进到可见语义节点、有限节点数、`browser_find`、cursor 读取和 document/ref 校验。仍需证明 DOM replacement、frame replacement、显著 DOM 变化后所有旧 ref 都稳定失效，并需要真实模型在有限上下文预算内完成论坛/视频 synthetic flow。

### C. Tool Runtime 集成

结论：**未完成**。

工具已接入 Session Factory，但没有真实 Provider 输出的完整 E2E 证据，也没有完整的每回合 12 次、每任务 40 步、连续无进展停止和 Journal structural event 证据。

### D. Browser Console/Human Control

结论：**部分通过，不能用于真实登录**。

loopback、Bearer、短期 cookie、CSRF 基础已存在；但页面仍缺实时截图、SSE 状态流、ownership、点击坐标映射、普通键盘控制、secret input endpoint、断线保持 user-control 和释放后强制重新观察。

### E. Vault/Credential Approval

结论：**未完成**。

当前 Vault 是可工作的简化 envelope，不是设计要求的最终密码簿：缺 KDF 参数记录、加密 sentinel、每字段独立 nonce、AAD 绑定、失败解锁退避、损坏恢复、并发写锁以及与 Browser 表单识别的联动。`y/n/other` 尚未证明能绑定 session/tab/document/origin/credential/expiry 并安全填入真实表单。

### F. Network/File/Prompt Injection

结论：**未完成**。

基础 URL 阻断已存在，但 DNS resolve 前后检查、redirect revalidation、跨 Origin iframe、popup、下载/上传 allowlist、敏感路径阻断、MIME/大小/hash 约束和 prompt injection fixture 尚未形成完整证据链。

### G. Cross-platform/Real Environment

结论：**未通过**。

Windows 自动化和部分真实网页访问已有证据；Linux 无 DISPLAY、SSH `-L`、另一台机器访问 Console、Host 重启后锁定和无孤儿进程尚未验证。不能用 Windows 结果替代 Linux/SSH 证据。

## 6. 风险评级

| 风险 | 等级 | 影响 |
|---|---|---|
| 真实密码进入错误边界 | 严重 | 在 CredentialFillService/secret endpoint 完成前，不应接入真实账号 |
| Agent 在人工接管期间继续操作 | 严重 | 可能覆盖用户输入或执行未授权动作 |
| 旧 ref 指向错误元素 | 高 | 页面变化后可能产生错误点击/输入 |
| Console 断线后状态恢复错误 | 高 | 可能在用户失去控制时继续自动化 |
| 私网/重定向/DNS 绕过 | 高 | 可能访问内网或 metadata 服务 |
| Linux/SSH 未验证 | 高 | 目标部署形态没有实际可用性证据 |
| 自动测试误报完成 | 中 | 大量真实环境测试为 opt-in/skip，容易把离线绿灯误解为完整通过 |

## 7. 当前可安全承诺的能力

当前可以对用户承诺：

- Isla 核心 CLI/Session/Tool 回归保持通过。
- 在受控测试环境中可以启动隔离 Chromium。
- 可以对页面进行有限的语义观察、查找、读取和部分普通交互。
- Browser Console 有 loopback 和基础认证边界。
- Browser Tool 已开始建立 document/ref 和秘密输入边界。
- 当前实现适合作为继续开发 v0.4.7 的原型基线。

当前不能承诺：

- 自动完成真实网站登录。
- 安全保存并自动填充真实密码。
- 通过 SSH 远程人工接管浏览器。
- 在 Console 断线、弹窗、iframe、下载上传或重定向场景下安全恢复。
- v0.4.7 完整验收通过。

## 8. 最终判定

**判定：v0.4.7 当前为“实现持续推进中的浏览器 Agent 原型”，不是“验收完成版本”。**

要升级为“核心验收通过”，至少需要补齐：

1. Agent 真实 Tool Call synthetic 论坛/视频只读闭环。
2. 完整 Browser Console UI、SSE、ownership、secret input 和断线语义。
3. 完整 Vault envelope、一次性凭据授权和 CredentialFillService。
4. 下载/上传、iframe、popup、redirect/DNS、prompt injection 安全测试。
5. Linux headless + SSH tunnel + 人工接管 + y/n/other 真实证据。
6. 真实低风险登录和关闭/重启后的进程、Profile、Vault 状态审计。

在以上证据齐全前，版本状态应保持“设计已完成、原型实现中、核心验收未通过”。

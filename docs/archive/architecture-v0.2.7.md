# Isla v0.2.7 架构基线：受控只读公网获取

## 1. 唯一目标

v0.2.7 只增加一个真实外部能力：`web_fetch`。模型可以读取用户在启动 Profile 中明确允许的公开 HTTPS 文本资源；整个获取过程有确定的 URL、DNS、连接、重定向、时间、大小、内容类型、取消、审批和隐私边界。

本版不增加 `web_search`、通用 HTTP Client、浏览器、下载、认证请求、Shell、后台任务或 MCP。网络能力不是 Agent Loop 的新阶段，而是现有 Tool capability 的一个普通成员。

## 2. 现有硬约束

- `StoredSession.messages` 仍是模型可见对话正文的事实源；实际发送给模型的 Tool Call 和 Tool Result 必须可重建；
- `ChatSession → ToolRuntime → Tool.execute` 契约不增加网络专用分支；
- `ApplicationContext/SessionFactory` 是能力装配的唯一生产入口，CLI 与 NDJSON 不各自创建网络 Tool；
- 每个 Turn 的同一 `AbortSignal` 必须到达 DNS 等待、连接、重定向和响应流读取；
- 取消继续使用 v0.2.6 的 `TURN_CANCELLED`、唯一终态和 quiescence 语义；
- `permission.kind: "network"` 不加入 `readonly` 或 `workspace` 自动放行集合；`never` 拒绝、`ask` 请求批准、`always` 按用户显式策略执行；
- 默认测试完全离线，不访问真实公网、真实 DNS、真实代理、真实 Profile、Session、Memory 或 Key；
- 配置、日志、协议和持久化不得泄露 API Key、Authorization、Cookie、代理凭据或完整环境变量；
- 不为 DSH 兼容而复制其 Cordis、WebRuntime、Provider Registry、package seam、middleware 或 spill framework。

## 3. DSH 完整实现参考

本设计复核 DeepSeek Harness `master` 在 2026-09-13 可见的完整网络链路：

- [`docs/subsystems/web.md`](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/web.md)；
- [`packages/web/web/src/types.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/web/web/src/types.ts)；
- [`packages/web/web-fetch-http/src/index.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/web/web-fetch-http/src/index.ts)；
- [`packages/web/web-fetch-http/src/provider.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/web/web-fetch-http/src/provider.ts)；
- [`packages/web/web-fetch-http/src/network.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/web/web-fetch-http/src/network.ts)；
- [`packages/web/web-fetch-http/src/policy.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/web/web-fetch-http/src/policy.ts)；
- [`packages/web/tool-web`](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/web/tool-web)。

### 3.1 采用

| DSH 思路 | Isla v0.2.7 决策 |
|---|---|
| 安全获取与模型展示分离 | 采用。Transport 返回结构化结果，Tool 负责不可信内容提示和 HTML→Markdown 展示 |
| 模型参数只包含 URL | 采用。不允许模型指定 timeout、headers、method、format 或认证信息 |
| 请求匿名 | 采用。不发送 Cookie、Authorization、Referer 或环境凭据，只发送固定 User-Agent 与 Accept |
| URL 先做纯策略校验 | 采用。长度、协议、凭据、hostname 和 allowlist 在 DNS 前检查 |
| 解析全部地址并 fail closed | 采用。任一解析结果非公网则整次拒绝 |
| 校验后的地址固定到连接 | 采用。阻止校验后再次 DNS 解析造成 rebinding/TOCTOU |
| IPv4、IPv6、IPv4-mapped IPv6、NAT64 一致判断 | 采用。不能只靠 hostname 或 IPv4 字符串黑名单 |
| 手动处理重定向 | 采用。每跳重新验证；只允许同源；有明确跳数上限 |
| 非 2xx 是资源状态，不是 transport failure | 采用。返回状态码及有界文本正文 |
| Content-Length 预拒绝与流式实际字节上限 | 采用。声明超限立即拒绝；未声明或少报时只保留有界前缀并标记截断 |
| 字节上限与字符上限分开 | 采用。先限制下载，再按声明 charset 解码并限制模型输入字符数 |
| Provider backstop timeout 与 Turn cancel 区分 | 采用。资源超时是 `WEB_FETCH_TIMEOUT`；Turn 取消仍是 `TURN_CANCELLED` |
| 关闭/取消响应体与私有连接池 | 采用。Tool settle 前完成必要清理，满足 quiescence |
| 封闭的 html/text body kind | 采用。新增类型必须同步修改获取和展示两端 |

### 3.2 Isla 收窄或调整

| 主题 | DSH | Isla v0.2.7 |
|---|---|---|
| 协议 | HTTP 与 HTTPS | 只允许 HTTPS |
| 公网目标 | 任意公网目标 | 还必须命中 Profile 的精确 hostname allowlist |
| IP literal | 公网 literal 可通过 | 全部拒绝；allowlist 只接受规范域名 |
| 启用方式 | deployment composition | Profile 显式启用且 allowlist 非空；默认关闭 |
| Provider seam | 可注册/选择多个 Web Provider | 不建立 Registry；只有一个内置安全 HTTPS transport |
| Approval | 由外部 policy 决定，默认组合可免批 | 复用现有 network permission；不加入自动放行 preset |
| Proxy | DSH 可走集中代理策略 | 本版不读取 HTTP(S)_PROXY/NO_PROXY，不支持代理 |
| Output spill | 可由通用 spill policy 处理 | 不引入 spill；在 acquisition 和 presentation 两层直接限界 |

### 3.3 暂缓

- `web_search` 和搜索 Provider；
- 跨源重定向后的自动二次请求；
- 通配符域名、子域继承、每 Turn 临时扩展 allowlist；
- HTTP/HTTPS/SOCKS 代理；
- PDF、图片、音视频、压缩包和任意二进制；
- 浏览器渲染、JavaScript、登录态、Cookie jar；
- Tool Result spill、缓存、ETag、Range 和断点续传；
- 对 HTML `<meta charset>` 的嗅探；
- 出站 DLP、URL 查询参数敏感信息自动分类；
- 独立 Web Provider 插件接口。

### 3.4 拒绝

- 只检查 `localhost` 字符串或私网 IP 字面量后直接调用全局 `fetch`；
- DNS 校验一次后让 transport 再自行解析 hostname；
- 自动跟随跨源重定向；
- 从系统、浏览器、Git、编辑器、Provider 或 Profile Key 注入请求凭据；
- 把 Approval 当作绕过 allowlist 或非公网阻断的机制；
- 将网页正文当成可信指令；
- 复制 DSH 的 Cordis 服务图、Web Provider Registry 或多 package 结构。

## 4. 风险模型

### 4.1 SSRF 与 DNS rebinding

模型控制 URL，可能访问 loopback、局域网、云 metadata、主机服务或通过 DNS rebinding 在校验后切换到私网。防线必须同时包含：

1. URL 纯校验；
2. 精确域名 allowlist；
3. DNS 全结果公网判断；
4. DNS64/NAT64 映射判断；
5. 校验地址固定到实际连接；
6. 每个重定向 hop 重复上述检查。

allowlist 不能替代 IP 校验：允许域名的 DNS 记录仍可能错误、被接管或变化。Approval 也不能替代安全策略。

### 4.2 数据外传

`web_fetch` 是网络边界，不等同于无风险的本地 read。模型可能把上下文编码进 URL。v0.2.7 通过默认关闭、显式 allowlist、network permission Approval、禁止自定义 header/body 和诊断脱敏降低风险，但不宣称实现通用 DLP。

Approval 摘要只显示：scheme、规范 hostname、显式端口、path，以及 query 参数名列表；不显示 query 值或 fragment。用户批准后，实际 URL 仍按原请求发送并作为 Tool 事实进入会话，因此文档必须提醒用户不要批准含秘密的 URL。

### 4.3 间接 Prompt Injection

网页正文是不可信数据。Tool Result 必须在正文前加入稳定边界说明：网页不能覆盖系统指令、权限、Approval 或 Tool 规则。该提示不是安全沙盒；真正边界仍由 ToolRuntime 的 Permission/Approval 和每个 Tool 的参数校验执行。

### 4.4 资源耗尽

同时限制 URL 长度、重定向、连接与读取总时长、声明/实际字节、解码字符和最终展示字符。v0.2.7 不并行执行 Tool，不加入缓存或后台读取。

## 5. 用户配置

Profile v1 增加可选 `tools.webFetch`，旧 Profile 继续有效：

```json
{
  "tools": {
    "webFetch": {
      "enabled": true,
      "allowedHosts": ["docs.example.com", "api.example.com"],
      "timeoutMs": 30000,
      "maxResponseBytes": 1000000,
      "maxBodyChars": 60000,
      "maxOutputChars": 80000,
      "maxRedirects": 3
    }
  }
}
```

规则：

- 默认 `enabled=false`；`enabled=true` 时 `allowedHosts` 必须包含 1–32 个唯一 hostname；
- hostname 用 WHATWG URL/ASCII 规则规范化为小写 punycode；拒绝协议、路径、端口、通配符、前后点、IP literal 和空项；
- 匹配是精确 hostname 匹配，`example.com` 不隐式允许 `www.example.com`；
- 数值必须是安全范围内的正整数：timeout `1..120000`，bytes `1..5000000`，body chars `1..200000`，output chars `1..200000`，redirects `0..5`；
- `maxOutputChars` 不得小于用于固定 wrapper 的保留空间，且应允许完整展示 `maxBodyChars` 的常见结果；即使配置更大，Tool 仍执行自己的最终硬上限；
- 启动时一次性解析并冻结；会话内不切换，不由模型修改；
- `--env` 开发入口若继续支持等价配置，使用明确的 `ISLA_WEB_FETCH_*` 变量，不从通用代理环境变量推断网络策略；
- `config` 展示只报告 enabled、allowlist 数量和资源上限，不打印 Key，也不展开完整 URL 历史。

如果实施发现 Profile v1 的向后兼容新增无法清晰表达，应停止并讨论 config version 2；不得静默改变旧字段含义。

## 6. 组件边界

保持单 package，只增加由现实职责驱动的文件：

```text
src/web/
  types.ts       # WebFetchRequest/Result、闭合 body kind、稳定错误码
  policy.ts      # URL、allowlist、origin、content-type、charset 纯函数
  network.ts     # DNS 公网判断、NAT64、固定地址连接
  fetch.ts       # timeout、重定向、读取上限、清理
src/tools/
  web-fetch.ts   # Tool schema、Approval 摘要、HTML→Markdown、模型展示
  web.ts         # 单个 web capability 组合
```

`src/web` 是内置安全获取边界，不是开放 Provider 平台。`ApplicationContext/SessionFactory` 根据冻结配置把 `createWebCapability(config)` 与现有 project-files capability 一起注入；未启用时不注册 schema，也不增加 Prompt 指令。

为了验证 DNS 与连接绑定，可以给 `network.ts` 的内部工厂注入窄化 resolver/dispatcher seam；它不是公共 Runtime DI，也不得暴露任意 transport 给模型或 Profile。

## 7. 核心契约

模型可见参数保持最小：

```ts
interface WebFetchArgs {
  readonly url: string;
}
```

内部安全获取结果：

```ts
interface WebFetchResult {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly statusCode: number;
  readonly contentType: string;
  readonly body:
    | { readonly kind: "html"; readonly content: string }
    | { readonly kind: "text"; readonly content: string };
  readonly bytesRead: number;
  readonly truncated: boolean;
}
```

`ToolSuccessDetails` 增加封闭成员：

```ts
interface WebFetchToolDetails {
  readonly type: "web_fetch";
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly statusCode: number;
  readonly contentType: string;
  readonly bodyKind: "html" | "text";
  readonly bytesRead: number;
  readonly truncated: boolean;
}
```

details 是 Runtime 权威事实；展示字符串不是内部解析协议。v0.2.7 不增加 `response_end.webSources`：最终 URL 已存在于可重建 Tool Result/details 中，公共 provenance 投影等出现多来源搜索需求后再设计。

## 8. URL 与目标策略

请求进入网络前按顺序执行：

1. JSON 参数必须只有合法非空 `url`；
2. 原始 URL 长度不超过 2048；
3. WHATWG `URL` 解析成功；
4. 协议必须严格为 `https:`；
5. username/password 必须为空；
6. hostname 必须是规范域名而非 IPv4/IPv6 literal；
7. hostname 精确命中冻结 allowlist；
8. fragment 从实际请求和最终结果中移除；
9. 使用 DNS `lookup(..., { all:true, order:"verbatim" })` 获取完整地址集合；
10. 结果非空，family 与文本 IP 一致；
11. 每个 IPv4/IPv6/IPv4-mapped 地址均为公网单播；
12. 对存在 IPv6 答案的环境检查活动 DNS64 前缀，拒绝映射到非公网 IPv4 的结果；
13. 把通过校验的地址集合固定给本次 HTTPS 连接，同时保持原 hostname 作为 Host 与 TLS SNI。

任一答案非公网即拒绝整个集合，不能挑一个公网地址继续。DNS 等待无法真正取消底层 OS 查询时，以 signal race 立即结算调用方，并移除监听；迟到 DNS 结果不得触发连接或污染下一 Turn。

## 9. 请求与重定向

每个实际 hop：

- 只发 GET；
- `redirect: "manual"`；
- 只发送固定 `User-Agent: Isla/<version> (+https://github.com/Winc159/Isla)` 和文本 `Accept`；
- 不读取或转发 Cookie、Authorization、Referer、客户端证书或代理变量；
- 301、302、303、307、308 视为重定向；
- 缺少合法 Location 的重定向是结构化失败；
- 相对 Location 相对当前 URL 解析；
- 新 URL 重新执行长度、协议、凭据、hostname、allowlist 检查；
- 只允许 scheme、hostname、显式有效端口相同的同源跳转；
- 每一跳重新解析公网地址并固定连接；
- 跨源跳转返回 `WEB_REDIRECT_BLOCKED`，提示模型如确有需要发起新的 Tool Call；
- 达到 `maxRedirects` 后，在发下一请求前拒绝；
- 离开任一 hop 前取消未消费 body 并关闭该请求的私有 dispatcher。

## 10. 内容读取与展示

允许：

- `text/html`、`application/xhtml+xml` → `html`；
- 其他 `text/*`；
- `application/json`、`application/xml`、`*+json`、`*+xml` → `text`。

缺失 Content-Type、二进制类型或未知 charset 均 fail closed。charset 只从 Content-Type 读取，缺失时 UTF-8；本版不嗅探 HTML meta。

读取规则：

- Content-Length 明确大于 `maxResponseBytes`：取消 body 并返回 `WEB_FETCH_TOO_LARGE`；
- 流实际超过上限：保留不超过上限的前缀、取消 reader、`truncated=true`；
- 恰好等于上限且下一次读取为 EOF：不得误标截断；
- 解码后超过 `maxBodyChars`：按 JavaScript 字符串边界裁剪并 `truncated=true`；
- HTML 由 Tool 层转换为 Markdown/GFM，不执行脚本、不加载子资源；
- Tool wrapper、元数据和正文合计不得超过 `maxOutputChars`；二次裁剪继续设置 `truncated=true`；
- 输出明确包含 final URL、HTTP status、content type 和截断标记；正文前标记为不可信外部资料。

HTML 转换库属于展示实现依赖；选择前检查维护状态、许可证、Node 24/ESM 和 `npm pack` 产物。不得自写脆弱正则 HTML parser。

## 11. 超时、取消与 quiescence

每次 fetch 合并两种控制来源：

- Turn signal：用户取消、disconnect 或 shutdown，最终规范化为 `TURN_CANCELLED`；
- `webFetch.timeoutMs`：资源 backstop，规范化为 `WEB_FETCH_TIMEOUT`。

第一原因生效，但只有能证明由本地 timeout controller 触发时才能报告 `WEB_FETCH_TIMEOUT`；外层 Turn 已取消时不能误报 timeout。signal 同时覆盖 DNS race、TLS/请求、redirect loop 和 body reader。

取消或失败时必须：

1. 不启动下一 hop；
2. 取消当前 body/reader；
3. 关闭本次私有 dispatcher；
4. 移除 abort listener 和 timer；
5. 等待已启动清理结算；
6. 再让 ToolRuntime/ChatSession 产生终态。

取消后不进行 Provider 重试、不重放 Tool、不提交 assistant；已保存 user 保留；Journal 继续记录 cancelled Turn、aborted Attempt 和实际发生的 Tool action，不保存任意 AbortSignal.reason 正文。

## 12. 错误模型

`ToolFailureCode` 与 `ToolExecutionResult` 的封闭错误联合向后兼容地增加下列网络 code；`ToolFailure` 将安全分类保留到模型可见 Tool Result。不能把所有网络拒绝折叠为 `EXECUTION_FAILED`，也不能使用任意开放字符串绕过 TypeScript 穷尽检查：

| Code | 含义 | 可重试 |
|---|---|---:|
| `WEB_INVALID_URL` | JSON/URL/协议/hostname 不合法 | 否，需改参数 |
| `WEB_HOST_NOT_ALLOWED` | hostname 不在启动 allowlist | 否，需改配置或 URL |
| `WEB_BLOCKED_URL` | IP literal、非公网解析、NAT64 私网映射 | 否 |
| `WEB_REDIRECT_BLOCKED` | 跨源、缺失 Location 或超过 hop 上限 | 视新 URL 而定，不自动重试 |
| `WEB_FETCH_TOO_LARGE` | 声明长度超过硬上限 | 否 |
| `WEB_UNSUPPORTED_CONTENT_TYPE` | 缺失/二进制 MIME 或未知 charset | 否 |
| `WEB_FETCH_TIMEOUT` | fetch 资源 backstop 到期 | 可由用户显式重试 |
| `WEB_NETWORK_ERROR` | DNS、TLS、连接或流读取失败 | 可由用户显式重试 |
| `TURN_CANCELLED` | 当前 Turn 取消 | 否 |

不增加自动重试。对模型返回稳定、安全、可行动的短消息；底层地址、代理、Header、查询值、响应正文和原始异常只作为内存 cause，不进入普通诊断或协议。

## 13. Approval 与入口

`web_fetch.permission = { kind: "network" }`。现有策略语义保持：

- `approvalPolicy="never"`：`PERMISSION_DENIED`，不解析 DNS、不发网络；
- `approvalPolicy="ask"`：显示脱敏摘要，批准后在执行前再次检查 signal；
- `approvalPolicy="always"`：这是 host 的显式自动批准选择，仍不能绕过 URL、allowlist 或公网地址策略。

NDJSON 沿用 `approval_request/approval_response`，不增加网络专用批准事件。`ready.capabilities` 增加可选 `webFetch` 布尔值，只有配置启用、Provider 支持 Tool Calling、完整测试通过时为 true；旧客户端可忽略新增字段。

CLI header/help 和 `config` 视图报告网络是否启用，但不显示整个 allowlist，除非用户运行明确的配置详情命令且该行为已有安全输出约定。

## 14. 诊断与隐私

允许记录：Tool 名、稳定错误码、阶段、耗时、redirect 次数、bytes/chars 数量、truncated、hostname 的不可逆摘要或仅 hostname（取决于现有日志等级约定）。

禁止进入 stdout/stderr、普通日志、CI artifact：

- URL query value、fragment；
- Authorization、Cookie、代理 URL/凭据和请求/响应 headers；
- 网页正文；
- DNS 完整答案集；
- 用户 prompt、Tool arguments 或原始异常对象。

会话必须保存模型实际看到的 Tool Call/Result，这是可重建不变量，不属于诊断日志。测试使用秘密哨兵扫描 Session 外的所有输出；文档明确提示 URL 本身会进入私人 Session。

## 15. 依赖决策

Node 24 全局 Fetch 无法直接注入固定 DNS lookup。实施可采用与 DSH 相同方向的 `undici` per-request Agent/dispatcher；公网地址分类可使用小型成熟库（DSH 使用 `ipaddr.js`）。新增依赖必须：

- 由地址固定或正确 IP 分类这一现实需求驱动；
- 固定在 lockfile，许可证兼容 MIT；
- 不读取环境代理或改写全局 dispatcher；
- 不造成其他 Provider 的 global fetch/dispatcher 行为变化；
- 有 `npm pack --dry-run` 和跨平台测试；
- 不把 DSH 包作为依赖。

## 16. 明确不做

- web_search、搜索结果聚合和引用排序；
- HTTP、FTP、file、data 或自定义协议；
- POST/PUT/PATCH/DELETE、request body、自定义 header；
- 下载或写文件；
- Browser/DOM/JavaScript；
- 登录、Cookie、OAuth、API Key 网络 Tool；
- Proxy、VPN 探测或企业 CA 管理；
- 并行 Tool、后台 fetch、缓存、自动重试；
- Shell、Git、MCP、子 Agent；
- 通用 DI、事件总线、Web Provider Registry、spill store；
- 自动从网页指令发起高风险动作。

## 17. 完成标准

1. `web_fetch` 默认不可见，只有 Profile 显式启用且 allowlist 有效时注册；
2. 模型只能提供一个 URL，不能控制 method、headers、timeout 或认证；
3. 只允许精确 allowlist 中的 HTTPS 域名，拒绝所有 IP literal；
4. DNS 全答案公网校验、NAT64 判断和连接地址固定均由测试证明；
5. 重定向手动处理、逐跳重验且只允许同源；
6. 响应时间、字节、字符、展示和 hop 均有硬上限；
7. 只解码受支持文本类型，HTML 安全转换为有界 Markdown；
8. 非 2xx 作为结构化结果返回；
9. network permission、Approval、拒绝和批准路径在 CLI/NDJSON 等价；
10. 同一 Turn signal 到达 DNS、请求和 body read，取消后达到 quiescence；
11. 错误分类稳定，不把 timeout/network/blocked 映射成用户取消；
12. Tool details 是权威事实，不从展示文本反向解析 URL 或状态；
13. 默认离线测试、typecheck、build、pack 和 diff-check 全部通过；
14. 至少一次用户明确授权的真实 HTTPS allowlist 场景通过；
15. 未实现本版所有暂缓和拒绝项。

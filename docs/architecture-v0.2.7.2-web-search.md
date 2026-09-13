# Isla v0.2.7.2 架构基线：Web Search 与证据感知综合

状态：待确认后实施  
日期：2026-09-13  
目标名称：Web Search and Evidence-Aware Planning

## 1. 唯一目标

v0.2.7.2 只补齐一个当前真实缺口：让 Agent 在不知道具体 URL 时先通过 `web_search` 发现可引用来源，再按需使用现有 `web_fetch` 读取原文，并在最终回答中区分已取得的外部证据、用户条件、估算和未核实信息。

本版验证以下闭环：

```text
understand
→ clarify（缺少关键用户约束时）
→ execute_tools
   → web_search
   → 可选 web_fetch
→ evidence validation
→ synthesize
→ complete
```

Web 仍是普通可选 Tool capability，不成为 Agent Loop 的新核心阶段。`web_search` 不替代 `web_fetch`：Search 用于发现来源和获得摘要，Fetch 用于读取选定页面的正文。

## 2. 当前实现基线与差异

设计和实施必须以当前源码为事实基线：

- v0.2.7.1 已有 `understand → clarify → execute_tools → synthesize` 的阶段式 Agent Loop；
- `TaskBrief` 已跨轮保存用户确认条件、待确认问题和假设；
- `ToolCapability` 当前只有 `id`、`instructions`、`tools`，Web capability 已在 `src/tools/web.ts` 组合；
- `web_fetch` 已有 HTTPS、SSRF、公网 DNS、重定向、大小、超时、取消、不可信内容和结构化 details 边界；
- 当前生产配置实际把未配置的 Web Fetch 规范化为启用并允许 `"*"`，与 `docs/architecture-v0.2.7.md` 中“默认关闭且要求精确 allowlist”的旧基线不同；
- `package.json` 当前仍标记 `0.2.6.1`，版本标识与文档进度不同。

v0.2.7.2 不借实现机会静默修复上述两项历史差异。Web 默认策略和包版本统一应作为显式收口批次记录并单独验证。

## 3. DSH 参考结论

本版参考 DeepSeek Harness 当前 Web capability：

- [Web subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/web.md)
- [`dsh-web` package](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/web/web)
- [`dsh-tool-web`](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/web/tool-web)
- [`web_search` consumer](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/web/tool-web/src/search.ts)
- [DeepSeek search provider](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/web/web-search-deepseek)

### 3.1 采用

| DSH 决策 | Isla v0.2.7.2 决策 |
|---|---|
| Search 与 Fetch 是一个 Web capability seam 上的两个独立操作 | 采用。共享配置、取消和错误词汇，但不合并请求与结果类型 |
| Provider 注册能力，Tool 层拥有模型可见 schema、提示和展示 | 采用。搜索协议不会进入 Agent Loop 或 Tool 定义 |
| Search request 每次只承载一个 query | 采用。第一版模型参数也只接受单个 `query`，不做并发批量搜索 |
| `maxResults` 由 consumer 配置，不让模型指定 | 采用。默认 8，Provider 可用于请求优化，边界层必须再次截断 |
| Source 只强制 URL，标题、摘要、发布时间均可选 | 采用。适配器不得编造缺失字段 |
| Provider 可返回可选生成式 answer/content | 采用为可选字段，但它仍是不可信搜索资料，不是 Isla 最终答案 |
| Tool Result 同时保留模型文本与结构化来源元数据 | 采用。文本用于模型上下文，details 用于 Runtime 校验和协议投影 |
| Provider 不可用和请求失败使用稳定错误码 | 采用最小子集 |
| `AbortSignal` 从 Turn 直接传到 Provider | 采用，保持 v0.2.6 取消与 quiescence 语义 |

### 3.2 收窄

| 主题 | DSH | Isla v0.2.7.2 |
|---|---|---|
| Provider 数量 | DeepSeek、Exa、Perplexity 等多个 | 只实现一个 DeepSeek 官方搜索适配器 |
| Provider 选择 | 双 Registry、显式选择或唯一可用者自动选择 | 启动时装配一个 `WebSearchProvider`，不建 Registry |
| Tool 参数 | 当前 consumer 支持有限个 `queries[]` 并发扇出 | 第一版只接受 `query: string`，每次一个查询 |
| 并发 | Search Tool 可并发执行多个查询 | 保持现有 Agent Loop 串行 Tool 语义 |
| 展示 | 原生 Web result card 与 fallback 文本 | 只增加现有 ToolOutput/details；不增加 UI card 系统 |
| HTTP 栈 | 各 Provider 自有网络实现 | Search Provider 使用自己的认证 HTTPS 请求；不复用匿名 `web_fetch` transport |

### 3.3 暂缓

- Exa、Perplexity 或其他第二搜索 Provider；
- Provider Registry、运行时自动选择、热切换和优先级回退；
- 多查询数组、并行搜索和搜索结果去重排名；
- recency、domain、language、country、search depth 等 Provider 不一致参数；
- Web result card、浏览器 UI、缓存、spill 和持久化 Web 索引；
- 通用事实抽取、逐句自然语言蕴含验证和自动引用样式系统；
- 搜索结果自动 Fetch 全部 URL。

### 3.4 拒绝

- 抓取搜索引擎 HTML 页面作为生产 Search Provider；
- 把 DeepSeek 搜索协议加入 `ChatSession`、Agent Loop 或模型 Provider；
- 把搜索 Provider 的生成式回答直接作为 Isla assistant 回答；
- 让模型传入 API Key、endpoint、timeout、result limit 或任意请求头；
- 把 Memory、本地知识或模型参数知识标记为本轮已联网核实的证据；
- 为一个 Provider 提前复制 DSH 的 Cordis、双 Registry、多 package 或动态生命周期结构。

## 4. 组件边界

在现有单 package 中增加最少职责：

```text
src/web/
  types.ts                 # 扩展 Search request/result/provider/error 词汇
  search-deepseek.ts       # 首个真实 Search Provider 及私有 wire types
src/tools/
  web-search.ts            # schema、参数校验、结果展示、details
  web.ts                   # 同时组合 search/fetch tool
```

若实现证明 `src/web/types.ts` 同时承载 Search 与 Fetch 后仍清晰，则不拆 `search-types.ts`。不得仅为目录对称增加空包装文件。

依赖方向：

```text
ChatSession / Agent Loop
        ↓ only sees ToolCapability and Tool results
src/tools/web.ts
        ↓
src/tools/web-search.ts ──→ WebSearchProvider
src/tools/web-fetch.ts  ──→ WebFetchExecutor
        ↓                        ↓
search-deepseek.ts          existing fetch.ts
```

Search Provider 与模型 Provider 是不同职责。即使二者都使用 DeepSeek 凭据，搜索适配器也不能调用 `ModelProvider.generate()` 或伪造会话消息。

## 5. 核心契约

```ts
export interface WebSearchRequest {
  readonly query: string;
  readonly maxResults: number;
}

export interface WebSearchSource {
  readonly url: string;
  readonly title?: string;
  readonly snippet?: string;
  readonly publishedAt?: string;
}

export interface WebSearchResult {
  readonly content?: string;
  readonly sources: readonly WebSearchSource[];
  readonly truncated: boolean;
}

export interface WebSearchProvider {
  readonly id: string;
  search(
    request: WebSearchRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<WebSearchResult>;
}
```

模型可见参数保持更窄：

```ts
interface WebSearchArgs {
  readonly query: string;
}
```

`maxResults` 是 host 配置，默认 8，合法范围 `1..20`。模型不能请求更大结果集。

结构化 Tool details：

```ts
interface WebSearchToolDetails {
  readonly type: "web_search";
  readonly provider: string;
  readonly query: string;
  readonly sources: readonly WebSearchSource[];
  readonly truncated: boolean;
  readonly hasProviderContent: boolean;
}
```

`ToolSuccessDetails` 增加 `WebSearchToolDetails`。Search Result 的正文展示不是 Runtime 内部解析协议；证据判断读取 details。

## 6. 首个 Search Provider

第一版实现 `deepseek-official` Provider，参考 DSH 的 DeepSeek 官方 Search Provider，但只复制协议所需事实，不复制其插件框架或源码结构。

选择理由：

- 当前 Isla 第一阶段已经支持 DeepSeek，用户已有真实 DeepSeek 验收路径；
- DSH 已验证官方服务端搜索可以规范化为通用 `WebSearchResult`；
- 先完成一个真实 Provider 可验证 seam，符合“不为未来需求提前实现平台”的项目原则。

边界：

- endpoint、model、API version、最大搜索次数和认证由启动配置提供或使用明确默认值；
- API Key 只进入 Authorization/header 边界，不进入 Tool 参数、消息、日志、Journal、details 或错误文本；
- Provider 使用原生结构化搜索结果块；缺少结构化结果时失败，不从模型 prose 中正则抓 URL；
- Provider 返回前校验 URL、字符串长度、来源数量与总展示字符；
- Provider 使用 Turn signal，并有独立 backstop timeout；Turn 取消优先投影为 `TURN_CANCELLED`；
- Search 请求是认证外部读取，仍使用 `permission.kind = "network"` 和现有 Approval；Approval 摘要只展示查询的有界、安全预览。

如果正式实施时官方搜索端点、模型或结构化响应不适用于 Isla 当前 DeepSeek 账户，应在 Provider 批次停止，记录实测证据，再讨论切换 Exa；不得静默退化成网页抓取。

## 7. 配置边界

Profile v1 的 `tools` 增加可选 `webSearch`：

```json
{
  "tools": {
    "webSearch": {
      "enabled": true,
      "provider": "deepseek-official",
      "maxResults": 8,
      "timeoutMs": 30000
    },
    "webFetch": {
      "enabled": true
    }
  }
}
```

建议配置规则：

- 未配置 `webSearch` 时默认关闭；本版不把 Search 与现有 Web Fetch 的默认策略捆绑；
- `enabled=true` 时 Provider 固定为本版唯一合法值 `deepseek-official`；
- 搜索凭据优先使用明确的 Web Search credential 配置；若决定复用当前 DeepSeek Profile Key，必须在装配层显式投影，不能由 Provider 读取任意环境变量；
- `maxResults` 范围 `1..20`，默认 8；
- `timeoutMs` 范围 `1..120000`，默认 30000；
- endpoint 和协议版本如需开放配置，只允许 startup profile/env host 配置，不能模型可见；
- 配置显示只报告 enabled、provider 和边界，不显示 Key。

配置是否复用 DeepSeek 模型 Key 是实施前唯一仍需确认的安全选择。默认建议复用当前 DeepSeek Profile 的同一 Key，仅当当前会话 Provider 为 DeepSeek 时启用；跨 OpenAI/Local Profile 的独立 Search credential 留到出现真实需求时再加。

## 8. 搜索结果规范化与不可信边界

Provider 输出必须满足：

1. `sources` 总是数组；无结果返回空数组，不是异常；
2. 每个来源必须有合法绝对 HTTPS URL；非法项丢弃并计入安全诊断，不把原始值展示给模型；
3. `title`、`snippet`、`publishedAt` 只有 Provider 实际返回时才存在；
4. 字符串按固定单项和总量上限裁剪，裁剪后 `truncated=true`；
5. 超过 `maxResults` 时 seam/Tool 边界再次截断；
6. 精确重复 URL 可按首次出现去重，不能重新评分或推断来源权威性；
7. Provider `content`、标题和 snippet 全部是不可信外部资料；
8. Tool 展示明确提示模型引用相关 URL，并在需要原文时调用 `web_fetch`。

Search 返回 URL 不表示 Fetch 被允许。后续 `web_fetch` 仍独立经过其 URL、公网目标、权限和取消策略。当前 `"*"` Web Fetch 行为需要在独立安全收口决定前如实记录。

## 9. 证据模型

本版不建立通用知识图谱或句级事实验证器，只增加回合级的最小证据事实。

```ts
type WebEvidence =
  | {
      readonly kind: "search";
      readonly toolCallId: string;
      readonly query: string;
      readonly sources: readonly WebSearchSource[];
    }
  | {
      readonly kind: "fetch";
      readonly toolCallId: string;
      readonly requestedUrl: string;
      readonly finalUrl: string;
      readonly statusCode: number;
      readonly truncated: boolean;
    };
```

证据来自本轮成功 Tool details，不从展示文本反向解析。Search 与 Fetch 的关联按规范化 URL 建立：Fetch 的 requested/final URL 命中 Search source URL 时可标记为已深入读取；没有命中仍是合法独立 Fetch 证据。

本版只区分：

- `search_evidence`：发现了可引用来源或 Provider 搜索内容；
- `fetched_evidence`：成功读取了具体页面；
- `no_web_evidence`：本轮没有成功 Web Tool details。

它不宣称证明某个自然语言句子为真。

## 10. 外部事实与综合规则

不把 `freshness` 固定写进 `ToolCapability`。时效性是任务中事实需求的属性，而不是 Web Tool 永久属性。

在 `TurnDecision.execute` 上增加可选、受校验的需求描述：

```ts
interface EvidenceRequirement {
  readonly external: "none" | "preferred" | "required";
  readonly topics: readonly string[];
}
```

`topics` 只描述需要核实的事实类别，例如路线、交通、天气、价格、开放时间、预约或政策，不承载事实结论。

Runtime 最小规则：

- 用户明确要求“搜索、查一下、联网确认、最新、当前、今天”时，`external=required`；
- 旅行中的路线、交通、天气、价格、营业/开放时间、预约和政策属于 `required`；
- 稳定常识、纯写作、本地源码讨论不强制联网；
- `required` 且 Web Search 可用时，execute 阶段必须向模型暴露 Web Tool；
- `required` 但本轮无成功 Web Evidence 时，synthesize 提示必须要求明确写出“未核实/估算/当前无法联网确认”，不得使用“已查证、当前价格、实时路况”等确定措辞；
- Runtime 不用关键词正则删除最终答案，也不声称逐句证明；第一版通过结构化需求、Tool details 和综合提示形成可测试的保守降级。

为避免继续堆总 Prompt，规则分别属于：决策 schema、Runtime evidence projection、Web capability 短提示和 synthesis 阶段短提示。

## 11. 错误、重试与取消

`ToolExecutionResult` 增加最小稳定错误码：

| Code | 含义 | 自动重试 |
|---|---|---:|
| `WEB_SEARCH_INVALID_QUERY` | 参数为空、过长或结构非法 | 否 |
| `WEB_SEARCH_UNAVAILABLE` | Provider 未装配或缺少可用凭据 | 否 |
| `WEB_SEARCH_TIMEOUT` | Provider backstop 到期 | 否 |
| `WEB_SEARCH_RATE_LIMITED` | 服务端限流 | 否 |
| `WEB_SEARCH_RESPONSE_INVALID` | 缺少可用的结构化响应 | 否 |
| `WEB_SEARCH_NETWORK_ERROR` | DNS、TLS、连接或读取失败 | 否 |
| `TURN_CANCELLED` | Turn 已取消 | 否 |

v0.2.7.2 不增加 Tool 自动重试。Provider 模型请求重试策略不能自动套用到搜索请求，避免重复费用和不可见网络动作。模型可根据结构化失败决定换查询或保守综合，但受现有 Tool step 上限约束。

取消必须满足：

- 同一 Turn signal 到达 Search Provider；
- 取消后不启动后续 Fetch；
- 不提交 assistant；
- 不自动重放 Search；
- 网络和流清理结算后才产生唯一取消终态。

## 12. 协议、日志与隐私

- NDJSON 沿用 `tool_start` / `tool_end`，Tool 名分别为 `web_search`、`web_fetch`；
- `ready.capabilities` 增加可选 `webSearch`，旧客户端可忽略；
- v0.2.7.2 不增加完整 sources 到 `response_end`，来源仍可由 Tool details 重建；
- Query 是用户任务资料，可进入会话 Tool Call 事实，但普通诊断只记录长度、结果数、耗时和错误码；
- 日志不得包含 API Key、Authorization、Provider 原始响应、搜索请求 header 或任意完整环境变量；
- 错误消息不得回显凭据、底层响应正文或账户信息。

## 13. 旅行场景验收

第一轮：

```text
去重庆取车，然后自驾回广州，按照这个路线自驾游。
```

预期：进入 clarify，`outcome=needs_user`，无 Web Tool。

第二轮：

```text
计划 5 天，预算适中，2 人 1 名驾驶员，优先自然风景，接受高速。请继续原任务。
```

预期最小序列：

```text
tool_start(web_search)
tool_end(web_search, ok=true)
tool_start(web_fetch)       # 至少一个值得深入读取且策略允许的来源
tool_end(web_fetch, ok=true)
response_end(outcome=completed)
```

最终回答必须：

- 保留用户确认的 5 天、预算、人数、驾驶员、偏好和高速条件；
- 不重复第一轮已回答的问题；
- 区分来源支持的事实、路线/费用估算和仍待用户决定的事项；
- 引用实际 Search/Fetch 返回的 HTTPS URL；
- 未成功取得证据时明确降级，不把模型记忆写成已核实事实。

## 14. 不做的事情

本版继续不做：Agent Registry、Inbox、Cordis、后台任务、子 Agent、Web UI、浏览器、登录态搜索、订票支付、通用 Provider 平台、长期 Web 记忆、向量索引、通用生命周期框架和多 Provider 搜索编排。

## 15. 完成信号

只有同时满足以下条件才可宣布 v0.2.7.2 完成：

1. `web_search` schema、Provider 规范化、上限、错误、取消和隐私均有离线测试；
2. Search/Fetch details 可由会话状态重建；
3. evidence requirement 与无证据降级有确定性测试；
4. 第一轮旅行澄清不调用 Web；
5. 第二轮真实 NDJSON 完成 Search → Fetch → Synthesize；
6. typecheck、全量离线测试、build、pack:check 和 diff 检查通过；
7. 真实搜索只在用户明确允许且已有凭据时执行；
8. 文档明确记录包版本和 Web Fetch 默认策略的最终处理，不让规范继续分叉。
# DeepSeek 对话协议校正（v0.2.7.2）

DeepSeek Chat Completions 是无状态接口，每轮必须发送完整历史。工具调用历史必须保留模型返回的 assistant 消息，再追加对应的 tool 消息；不能只保留解析后的文本。实现因此保留 DSML 工具调用的原始 assistant 内容，并在下一轮同时携带工具调用信息。

Agent Loop 的决策阶段使用 DeepSeek JSON Output：请求显式设置 `response_format: { type: "json_object" }`，提示词包含 `json`，解析失败时使用同样的约束重试。该约束只用于结构化决策，不改变普通回答和工具调用请求。

# Isla v0.2.7.2 测试与验收：Web Search 与证据感知综合

状态：待架构确认后执行  
架构依据：`docs/architecture-v0.2.7.2-web-search.md`  
实施依据：`docs/luna-implementation-v0.2.7.2.md`

## 1. 测试目标

本版测试回答四个问题：

1. `web_search` 是否通过 Provider-neutral seam 返回有界、可引用且不编造字段的来源；
2. Search 网络请求是否遵守凭据、超时、取消、错误和隐私边界；
3. Agent 是否在澄清完成后形成 Search → 可选 Fetch → Synthesize 闭环；
4. 缺少成功 Web Evidence 时，最终回答是否保守降级而不是声称已核实。

默认测试必须完全离线。真实 Provider 测试只在显式环境开关、可用凭据和用户授权同时存在时运行。

## 2. 测试分层

```text
tests/web/
  search-types / normalization  # 公共结果和上限
  search-deepseek               # 私有 wire adapter 与网络错误

tests/tools/
  web-search                    # schema、展示、details、permission
  web-capability                # Search/Fetch 组合矩阵

tests/core/
  agent-loop                    # evidence requirement parsing
  session / tool-runtime        # 本轮 evidence 与综合降级

tests/protocol*.test.ts         # ready、事件、approval、cancel

tests/smoke/
  real-ndjson                   # 显式真实闭环
```

单元测试不得连接真实 DeepSeek、真实 DNS、搜索引擎网页或任意公网。

## 3. P0：Search 契约与规范化

### WS-001 单查询请求

- `WebSearchRequest` 接收一个非空 query；
- request 上限来自 host；
- 不支持模型提供 provider、key、endpoint 或 timeout。

### WS-002 可选来源字段

- URL 是唯一必需字段；
- title/snippet/publishedAt 缺失时保持缺失；
- 不用 hostname 写回 details.title。

### WS-003 来源 URL

- 接受合法绝对 HTTPS URL；
- 拒绝或丢弃相对 URL、HTTP、凭据 URL、非法 URL；
- URL fragment 不参与 Search/Fetch 证据关联；
- 不记录非法原值到普通诊断。

### WS-004 结果数上限

- Provider 返回不超过 limit 时原样保留；
- 超过 limit 时只保留前 N 个并设置 `truncated=true`；
- Provider 已标 truncated 时不得重置为 false。

### WS-005 去重

- exact normalized URL 重复项保留第一次；
- 不改变非重复来源的顺序；
- 去重不推断权威度、不合并互相冲突的 snippet。

### WS-006 字符边界

- 单 title、snippet、content 有上限；
- 总 Tool 输出有上限；
- Unicode 裁剪不产生无效字符串；
- 任一裁剪令 `truncated=true`。

### WS-007 空结果

- `{sources: [], truncated: false}` 是成功；
- Tool 明确显示无结果；
- 空结果不构成有来源的 search evidence。

## 4. P0：`web_search` Tool

### WT-001 Schema

- name 为 `web_search`；
- 参数只有 `query`；
- query required；
- `additionalProperties=false`；
- permission 为 network。

### WT-002 参数校验

覆盖：

- invalid JSON；
- 非对象；
- 缺 query；
- 非字符串；
- 空白字符串；
- 超长字符串；
- 多余字段；
- 模型尝试传 maxResults、timeout、provider 或 apiKey。

以上均在 Provider 调用前失败。

### WT-003 Host 上限

- Tool 把配置的 maxResults 传给 Provider；
- Provider 超量返回时 Tool/seam 再次截断；
- 模型不能提高上限。

### WT-004 Signal

- Tool 收到的 Turn signal 原样传给 Provider；
- 已取消 signal 不开始网络请求；
- 取消投影为 `TURN_CANCELLED`。

### WT-005 展示

- 外部资料不可信提示存在；
- 可选 content 与 sources 可读；
- 来源使用 Markdown URL；
- title 缺失时仅展示 hostname fallback；
- 提示引用相关 URL；
- Fetch 启用时提示按需读取原文；
- 截断提示准确。

### WT-006 Details

- details.type 为 `web_search`；
- 保存 provider、query、原始可选字段、sources、truncated 和 hasProviderContent；
- details 不含 API Key、header、endpoint 私密参数或 Provider 原始响应。

### WT-007 Approval

- `never` 在 Provider 前拒绝；
- `ask` 产生一次 approval_request；
- reject 不发网络；
- approve 后再次检查 signal；
- summary 只包含有界 query 预览，不包含 credential。

## 5. P0：DeepSeek Search Provider

所有测试使用本地 mock server 或 MSW，凭据只能使用明显的测试占位值。

### DP-001 请求映射

- endpoint 拼接正确；
- model、API version、max uses 和 query 映射正确；
- 请求包含服务端 Web Search Tool；
- 不发送会话历史、Memory、Workspace 内容或用户未提供资料；
- Authorization 只在 HTTP header。

### DP-002 正常结构化响应

- 解析一个或多个结构化搜索结果块；
- URL/title/snippet/publishedAt 正确规范化；
- 没有生成内容时省略 content。

### DP-003 URL-only 来源

- 只有 URL 仍是合法 source；
- Provider 不发明 title/snippet/publishedAt。

### DP-004 空结果

- 官方明确返回空搜索结果时映射为成功空数组；
- 不是 `WEB_SEARCH_RESPONSE_INVALID`。

### DP-005 无结构化结果

- 只有 prose 或 Markdown URL 时返回 `WEB_SEARCH_RESPONSE_INVALID`；
- 不正则抓取 URL；
- prose 不进入模型 Tool Result。

### DP-006 HTTP 错误

| 状态 | 预期 |
|---|---|
| 400 | response/request 类安全错误，不回显原 body |
| 401/403 | unavailable/auth 类安全错误，不回显 Key |
| 429 | `WEB_SEARCH_RATE_LIMITED` |
| 500/502/503 | `WEB_SEARCH_NETWORK_ERROR` 或明确 Provider error |

### DP-007 非法响应

- 非 JSON；
- JSON 结构缺失；
- source URL 非法；
- 字段类型错误；
- 超大响应；
- 重复来源。

均须有确定、安全的归一化结果或失败。

### DP-008 Timeout

- backstop 到期返回 `WEB_SEARCH_TIMEOUT`；
- timer 清理；
- 响应体/连接清理；
- 迟到响应不产生 Tool success。

### DP-009 Turn Cancel

- Turn cancel 优先于本地 timeout；
- 返回 `TURN_CANCELLED`；
- 不重试；
- 不启动后续 Fetch；
- quiescence 后才产生取消终态。

### DP-010 隐私

断言 stdout、stderr、diagnostic、Journal、Tool details 和错误消息都不包含：

- API Key；
- Authorization；
- Provider 原始 response body；
- 完整环境变量；
- 内部账户或计费信息。

## 6. P0：Web capability 组合

### WC-001 Search off / Fetch off

- 不注册 Web capability；
- Prompt 不出现 Web 指令；
- ready 两项均为 false/缺失。

### WC-002 Search on / Fetch off

- 只有 `web_search`；
- Prompt 不要求调用不存在的 Fetch；
- Search result 提示基于 snippet/content 保守回答。

### WC-003 Search off / Fetch on

- 保持现有 v0.2.7 `web_fetch` 行为；
- 无 Search schema 或提示回归。

### WC-004 Search on / Fetch on

- 两个 Tool 同属 id=`web` capability；
- 指令明确 Search 用于发现、Fetch 用于原文；
- 两者 network permission 独立审批；
- 不自动 Fetch 全部 Search results。

## 7. P0：Evidence Requirement

### EV-001 显式联网请求

输入包含明确的搜索、查证、联网、最新、当前或今天要求时，execute decision 必须能表达 `external=required`。

### EV-002 时效性旅行事实

路线、交通、天气、价格、开放时间、预约和政策进入 required topics。

### EV-003 稳定问题

稳定常识、纯写作、本地源码阅读和不涉及当前状态的解释不强制 Web。

### EV-004 先澄清

旅行请求缺关键用户约束时：

- outcome=needs_user；
- 无 Search；
- 无 Fetch；
- 不提前生成路线、价格或时间数字。

### EV-005 成功 Search Evidence

- Tool success 且至少一个合法 source 才形成带来源的 search evidence；
- 空结果仍记录执行事实，但不视为有来源证据；
- Tool failure 不构成 evidence。

### EV-006 Fetch Evidence

- 成功 `web_fetch` details 形成 fetch evidence；
- 非 2xx 仍是资源结果，但 synthesis 必须看到 status；
- truncated 状态保留。

### EV-007 Search → Fetch 关联

- Fetch requested/final URL 命中 Search source 时建立关联；
- fragment 差异不影响关联；
- redirect final URL 可保留 requested 与 final 两个事实；
- 未关联的独立 Fetch 仍是合法 evidence。

### EV-008 required 无证据

- Search 未启用；
- Provider unavailable；
- 用户拒绝 Approval；
- timeout/network error；
- Search 返回空来源；
- Fetch 失败。

以上场景的 synthesis 都必须收到保守降级要求，最终 fixture answer 不得包含“已查证、实时、当前价格确定”等声明。

### EV-009 evidence 不持久化重复正文

- Session 能从 Tool Call/Result/details 重建本轮事实；
- 不额外保存 Provider 原始 payload；
- 恢复会话后不会把上一轮 Search 误称为本轮当前证据。

## 8. P0：Agent Loop 离线闭环

使用 Fake Model Provider、Fake Search Provider 和 Fake Fetch Executor，模型输出按顺序受控。

### AL-001 两轮旅行成功路径

第一轮：

```text
prompt
→ understand
→ clarify
→ response_end(needs_user)
```

断言无 Tool。

第二轮：

```text
prompt(补充条件)
→ understand(execute, evidence required)
→ web_search
→ web_fetch
→ synthesize(with evidence summary)
→ response_end(completed)
```

断言：

- 不重复澄清；
- Search query 与任务相关；
- Fetch URL 来自 fixture Search source；
- 最终答案包含 fixture URL；
- 用户条件没有被 Provider content 覆盖；
- 不可信网页指令不能改变 Tool/Approval 规则。

### AL-002 Search-only 降级

- Search 成功，Fetch 因策略或内容类型失败；
- 最终答案可引用 Search source/snippet；
- 明确没有读取完整原文；
- 不把 snippet 写成已核实的完整页面事实。

### AL-003 无证据降级

- Search Provider 失败；
- Agent 仍能给出结构化建议；
- 具体价格、天气、开放时间和交通状态标为估算/未核实；
- 不生成虚假 citation。

### AL-004 Tool 步数有界

- 模型重复 Search 或 Search/Fetch 循环仍受现有 step 上限；
- 终态唯一；
- 不增加搜索专用无限重试。

## 9. P0：协议与取消

### PR-001 Ready capability

- Search on 时 `ready.capabilities.webSearch=true`；
- off 时 false 或缺失；
- Web Fetch 单独准确；
- 旧 NDJSON consumer 不因新字段失败。

### PR-002 通用 Tool 事件

- `tool_start(web_search)`；
- `tool_end(web_search)`；
- Search 后可出现 Fetch；
- 不增加搜索专用事件类型。

### PR-003 Approval

- approvalId 精确匹配；
- 拒绝后 response 正常收口或保守降级；
- 未批准不发 Search 请求。

### PR-004 Cancel

- Search 请求中 cancel 返回 ack；
- 只有一个 `response_cancelled`；
- 无 `response_end` 双终态；
- cancel 后无 Fetch、无迟到 tool_end success；
- 下一 Turn 不受污染。

### PR-005 Disconnect / Shutdown

- stdin 关闭或 shutdown 取消活动 Search；
- 等待 Provider 清理；
- 不遗留活动 timer、socket 或异步写日志。

## 10. P1：真实 NDJSON 评估

真实测试默认 skip，只有以下条件全部满足才运行：

- `ISLA_RUN_REAL_SMOKE=1`；
- 用户明确授权本次联网与可能产生的 API 费用；
- DeepSeek 搜索 credential 已配置；
- 临时 Profile 不写出 credential；
- 输出日志位置明确且脱敏。

### REAL-001 第一轮澄清

输入模糊重庆取车、自驾广州请求。

断言：

- needs_user；
- 无 Tool；
- 不出现 D1/D2、确定里程、确定费用或确定驾驶时长。

### REAL-002 第二轮联网

补充 5 天、适中预算、2 人、1 名驾驶员、自然风景和接受高速。

断言：

- 不重复问题；
- 至少一次成功 Search；
- 在 Fetch 策略允许时至少一次成功 Fetch；
- 最终引用至少一个本轮实际来源 URL；
- 用户条件、外部事实、估算和待确认项可区分；
- 无证据数字不表述为已核实。

### REAL-003 失败可诊断

若真实闭环失败，评估文档必须区分：

- Provider endpoint/protocol 不可用；
- credential/权限；
- rate limit；
- Search 成功但 Fetch policy 阻止；
- Agent 未调用 Tool；
- Tool 成功但 synthesis 未使用 evidence；
- driver/timeout 基础设施问题。

不能用一次失败直接宣称架构错误，也不能用 ready=true 宣称真实 Search 已通过。

## 11. 回归门禁

最终必须运行：

```text
npm run typecheck
npm test
npm run build
npm run pack:check
git diff --check
```

重点回归：

- 现有 Provider 问答；
- v0.2.7.1 clarify 与 continuation；
- Web Fetch URL/DNS/redirect/timeout/cancel；
- Tool permission/approval；
- Session v3、TaskBrief、Journal 恢复；
- NDJSON 唯一终态；
- Memory 与本地 Project Search 不被当作 Web Evidence；
- npm 包不包含测试日志、真实配置或秘密。

## 12. 完成报告必须包含

- 实现的 Search seam、Tool 与首个 Provider；
- 采用、收窄、暂缓和拒绝的 DSH 内容；
- 离线测试文件数、测试数和 skip 数；
- typecheck、build、pack 结果；
- 真实 NDJSON 是否运行及授权条件；
- Search → Fetch → Synthesize 是否真实通过；
- 无证据降级是否通过；
- package version 与 Web Fetch 默认策略是否已经由用户确认收口；
- 明确说明未 commit、未 push。


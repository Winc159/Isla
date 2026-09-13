# Isla v0.2.7.2 Luna 实施顺序：Web Search 与证据感知综合

状态：待架构确认后执行  
架构依据：`docs/architecture-v0.2.7.2-web-search.md`

## 0. 实施纪律

- 每次只加入一个可独立验证的能力，批次结束时保持项目可运行；
- 先写离线测试，再写对应生产实现；
- 不修改 Agent Loop 主阶段，不把 Web 变成核心专用分支；
- 不复制 DSH 的 Cordis、Registry、多 package、动态选择或 UI card；
- 不执行真实搜索，除非用户明确授权并确认可使用对应 API 凭据；
- 不执行 `git add`、`git commit`、`git push` 或 npm 发布；
- 不在日志、fixture、文档或错误快照中写入真实 API Key、用户查询内容或 Provider 原始响应；
- 若一个批次需要改变三个以上未计划的生产文件、引入新生产依赖或扩大 Provider 范围，停止并先讨论；
- 每批至少运行相关定向测试和 `npm run typecheck`；最终运行完整门禁。

## 1. 批次 A：冻结基线差异

目标：让实现前的事实状态可审计，不让 v0.2.7.2 顺手改变旧语义。

工作：

1. 确认 `package.json` 版本仍为 `0.2.6.1`；
2. 确认当前未配置 Web Fetch 时实际默认启用并使用 `allowedHosts=["*"]`；
3. 确认 v0.2.7 原文仍描述默认关闭和精确 allowlist；
4. 将最终选择写入本版 closeout 或单独修订文档；
5. 本批不修改版本号和 Web Fetch 默认策略，除非用户明确确认。

验收：

- 工作区状态已记录；
- 现有 Agent Loop 与 Web Fetch 定向回归通过；
- 没有生产代码修改。

## 2. 批次 B：Search 领域契约

目标：建立与 Provider 协议无关的最小 Search 词汇。

修改：

- `src/web/types.ts`
- 新增或扩展对应 `tests/web/*` 类型/规范化测试

实现：

- `WebSearchRequest`；
- `WebSearchSource`；
- `WebSearchResult`；
- `WebSearchProvider`；
- 搜索稳定错误码及错误映射入口。

约束：

- 每个 request 只有一个 query；
- `maxResults` 必填且为 host 边界；
- Source 只强制 HTTPS URL；可选字段不得由 adapter 补造；
- 不增加 Provider Registry、available() 或自动选择。

测试：

- 空来源是合法结果；
- 可选字段保持缺失；
- 超量来源被再次截断并标记 `truncated`；
- 非法 URL 被丢弃或产生明确规范化失败；
- exact duplicate URL 按首次出现去重；
- 所有字符和总量上限生效。

## 3. 批次 C：`web_search` Tool

目标：让模型通过稳定 Tool schema 发起单次查询。

创建/修改：

- `src/tools/web-search.ts`
- `src/tools/types.ts`
- `tests/tools/web-search.test.ts`

实现：

- 模型参数仅 `{ query: string }`；
- `additionalProperties=false`；
- query trim 后非空，并有固定最大字符数；
- Tool 从配置注入 `maxResults`，模型不能覆盖；
- `permission={ kind: "network" }`；
- Approval 摘要使用有界 query 预览；
- Provider result 渲染为不可信资料、可引用来源列表和可选 content；
- ToolOutput details 保存 provider、query、sources、truncated 与 content presence；
- Provider 错误映射为封闭 Tool failure code。

测试：

- schema 只暴露 query；
- 空白、过长、多余字段和非法 JSON 被拒绝；
- signal 原样传递；
- host result cap 不可被 Provider 绕过；
- 标题缺失时展示 hostname，但 details 不补造 title；
- 输出提示引用 URL 和按需调用 Fetch；
- 输出字符上限和截断标记正确；
- query/API Key 不进入诊断。

## 4. 批次 D：DeepSeek 官方 Search Provider

目标：实现第一个真实、可替换的 Search backend。

创建：

- `src/web/search-deepseek.ts`
- `tests/web/search-deepseek.test.ts`

实现：

- 独立的 provider-private request/response 类型；
- 使用 DeepSeek 官方服务端搜索的结构化结果；
- endpoint、model、API version、max uses、timeout 和 credential 由构造参数注入；
- 不通过 `ModelProvider.generate()`；
- 不从 prose 或 Markdown 正则提取 URL；
- 只接受结构化结果块；
- 把 Provider 字段规范化到公共 `WebSearchResult`；
- signal 覆盖请求和响应读取；
- 关闭定时器和 listener，满足 quiescence；
- 安全映射 timeout、rate limit、HTTP、网络和响应格式错误。

离线测试通过 mock HTTP 边界覆盖：

- 正常结构化响应；
- URL-only source；
- Provider 超量返回；
- 空结果；
- 只有 prose、没有结构化结果；
- 401/403 不泄露凭据；
- 429；
- 5xx；
- malformed JSON；
- timeout；
- Turn cancel；
- 取消后无迟到结果和新请求；
- request snapshot 不含真实 secret fixture。

停止条件：若官方端点或结构化协议无法由当前账户真实使用，不以 HTML 抓取或 prose 解析兜底；先报告并讨论 Exa Provider。

## 5. 批次 E：配置与唯一装配

目标：只在启动时明确启用 Search，并由 SessionFactory 唯一注入。

修改：

- `src/config.ts`
- `src/session-factory.ts`
- `src/application.ts`（仅当现有组合根确实需要）
- `tests/config-file.test.ts`
- 对应 application/session-factory 测试

实现：

- Profile `tools.webSearch`；
- `enabled` 默认 false；
- 唯一合法 provider `deepseek-official`；
- `maxResults` 和 `timeoutMs` 的默认值与范围；
- 启动时创建一个 Provider 并注入 Web capability；
- 未启用或没有明确可用凭据时不注册 Tool；
- 不在 Provider 内读取 `process.env`；
- 不新增 Registry。

需在本批前确认：是否只对 DeepSeek Profile 显式复用当前 `apiKey`。未经确认，不增加独立 `webSearchApiKey` 字段。

验收：

- 旧 Profile 仍可解析；
- Search 默认关闭；
- 启用配置冻结；
- 非法 provider/limit/timeout 失败；
- Key 不出现在配置展示；
- CLI、NDJSON 共用 SessionFactory 装配。

## 6. 批次 F：统一 Web capability

目标：`src/tools/web.ts` 同时组合 Search 与 Fetch，但二者可独立启用。

修改：

- `src/tools/web.ts`
- `tests/tools/web-capability.test.ts`
- Prompt capability 相关测试

实现：

- capability id 继续为 `web`；
- Search 与 Fetch Tool 各自按配置存在；
- Search 指令在 Fetch 可用时提示按需深入读取；
- Search-only 时提示根据 snippet/content 保守回答并引用 URL；
- Fetch-only 行为保持兼容；
- 不把 Provider 信息放进模型总 Prompt。

验收矩阵：

| Search | Fetch | 预期 |
|---:|---:|---|
| off | off | 不注册 Web capability |
| on | off | 只有 `web_search` |
| off | on | 只有现有 `web_fetch` |
| on | on | 两个 Tool，共享短提示 |

## 7. 批次 G：证据需求与综合降级

目标：在不建立通用事实验证器的前提下，确定性地区分“需要外部证据”和“本轮取得了什么证据”。

修改范围候选：

- `src/core/agent-loop.ts`
- `src/core/session.ts`
- `src/core/types.ts` 或 `src/tools/types.ts`
- `tests/core/agent-loop.test.ts`
- `tests/core/session*.test.ts`

实现顺序：

1. 给 execute decision 增加 `EvidenceRequirement`；
2. parser 校验 `external` 枚举、topics 数量和长度；
3. Runtime 从本轮成功的 `web_search` / `web_fetch` details 构建临时 `WebEvidence[]`；
4. synthesis request 注入有界 evidence summary；
5. `external=required` 且证据为空时注入保守降级要求；
6. 最终 response evidence 只保留已有契约真正需要的结构，不持久化 Provider 原始正文副本。

确定性规则测试：

- 用户明确要求搜索/联网/最新时为 required；
- 旅行路线、交通、天气、价格、开放时间、预约、政策为 required；
- 稳定常识和纯本地源码问题不强制 Web；
- required 且 Search 未启用时仍可回答，但必须标明无法核实；
- Search 失败不构成成功证据；
- Search 有 sources 构成 search evidence；
- Fetch details 构成 fetched evidence；
- Search URL 与 Fetch requested/final URL 可关联；
- 无证据时 synthesis 不允许声称已查证；
- 第一轮需要澄清时 evidence required 不得提前触发 Tool。

若仅靠 decision schema 无法稳定形成 required，允许在 Runtime 增加一个很小的用户显式词规则作为下限；不得扩展为通用 NLP 分类器或大量中文关键词表。

## 8. 批次 H：NDJSON 与可观测性

目标：让单一 Agent 能无 TTY 验证完整链路。

修改：

- `src/protocol/types.ts`
- `src/protocol/runner.ts`
- `src/cli.ts`
- 对应 protocol 测试

实现：

- `ready.capabilities.webSearch?: boolean`；
- 继续使用通用 `tool_start` / `tool_end`；
- 保持 approval request/response；
- 普通诊断只记录 provider id、结果数、truncated、耗时和稳定错误码；
- 不在 `response_end` 新增重复来源正文。

测试：

- 旧客户端忽略新 capability；
- Search 启用/关闭的 ready 投影准确；
- Approval 拒绝后不发网络；
- 取消 Search 只产生唯一取消终态；
- Search → Fetch 事件顺序可自动断言。

## 9. 批次 I：离线完整链路

目标：使用 Fake Provider 和 Fake Search Provider 验证完整 Agent Loop。

场景：

1. 模糊旅行请求进入 needs_user，无 Tool；
2. 用户补充条件后 execute；
3. 模型调用 `web_search`；
4. 模型从结果中选择一个允许 URL 调用 `web_fetch`；
5. synthesize 收到结构化 evidence summary；
6. 最终答案引用真实 fixture URL；
7. Search 失败分支明确写未核实，不制造 citation。

本批完全离线，不访问真实 DNS、真实 Provider 或真实 API Key。

## 10. 批次 J：真实 NDJSON 评估

目标：在用户明确授权后验证 DeepSeek Search 的真实闭环。

修改：

- `tests/smoke/real-ndjson.test.ts`
- `docs/evaluation-v0.2.7.2-web-search.md`（执行后创建）

前置条件：

- `ISLA_RUN_REAL_SMOKE=1`；
- 可用且经用户允许的 DeepSeek credential；
- 独立临时 Profile、Session 和 Memory；
- 日志路径显式设置且日志脱敏；
- Web Fetch 的目标策略已允许选定来源，或评估明确接受 Search-only 降级。

预期：

```text
ready(webSearch=true, webFetch=true)
prompt(clarify)
response_end(needs_user)
prompt(continue)
tool_start(web_search)
tool_end(web_search)
tool_start(web_fetch)
tool_end(web_fetch)
response_end(completed)
```

评估不能只断言出现 Tool 名，还必须核对：

- 第一轮无 Tool；
- 第二轮不重复澄清；
- 至少一个最终引用 URL 来自本轮 Search/Fetch details；
- 没有证据的数字被标记为估算或未核实；
- 不出现虚构历史对话；
- 真实日志不含 Key、Authorization 或 Provider 原始 payload。

## 11. 批次 K：规范收口

目标：消除已知版本和 Web 默认策略分叉。

在代码实现、真实评估结果明确后，向用户单独确认：

1. `package.json` 应一次性对齐到哪个版本；
2. Web Fetch 保持默认启用 `"*"`，还是恢复 v0.2.7 的默认关闭＋精确 allowlist；
3. Search credential 是否扩展为跨模型 Profile 独立配置。

确认后同步：

- `docs/roadmap.md`；
- `README.md`；
- v0.2.7 与 v0.2.7.2 文档状态；
- 配置样例与迁移说明；
- package version（若确认）。

不得在没有用户决定时自行选择更宽的网络默认策略。

## 12. 最终验证

按顺序执行：

```text
npm run typecheck
npm test
npm run build
npm run pack:check
git diff --check
git status --short
```

检查：

- 默认测试没有真实网络请求；
- `dist/cli.js` shebang 保留；
- npm dry-run 包不含 `.env`、真实日志、Session、Memory、Key 或测试 fixture secrets；
- Search 和 Fetch 的 Tool Call/Result 均可从 Session 状态重建；
- 取消后没有迟到 Tool event 或网络副作用；
- diff 不含 Registry、通用生命周期框架、UI 或第二 Provider；
- 未经用户要求没有 Git commit/push。


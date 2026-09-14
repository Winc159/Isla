# Luna：Isla v0.2.7 受控只读公网获取实施清单

## 1. 唯一基线

实施前完整阅读：

- `AGENTS.md`；
- `docs/architecture-v0.2.7.md`；
- `docs/testing-v0.2.7.md`；
- `docs/architecture-v0.2.6.md` 与取消收口；
- `docs/architecture-v0.2.5.1.md` 的 ApplicationContext/SessionFactory 边界；
- 当前 Config、ToolRuntime、Tool details、Approval、CLI、NDJSON、Journal 和诊断实现；
- 架构文档列出的 DSH web-fetch 源码与说明。

唯一交付能力是 `web_fetch`。任何 `web_search`、Shell、浏览器、认证请求、代理、缓存、后台任务、并行 Tool、MCP、通用 Web Provider Registry、通用 DI 或 spill framework 都超出范围，必须停止并重新确认。

## 2. 全程规则

- 严格按 Batch 顺序，每批只增加一个可独立验证的事实；
- 先写能在旧实现上失败的测试，再写生产代码；
- 每批完成后运行专项测试与 `npm run typecheck`，记录结果后停点；
- 安全策略函数优先纯函数；DNS、连接和时间通过窄注入 seam 测试，不访问公网；
- 不用固定 sleep 作为主要超时/竞态断言，使用 fake timer、deferred、barrier 或受控 stream；
- 不修改全局 dispatcher，不读取系统代理，不碰真实 home、Profile、Session、Memory 或 Key；
- 不把 URL query value、网页正文、DNS 地址或原始异常写进测试诊断；
- 不执行 Git add、commit、push、历史重写或 npm publish；
- 如果实现无法同时满足公网校验和连接地址固定，不得降级成 hostname 黑名单后直接 fetch。

## 3. Batch A：锁定配置和启用边界

1. 为 Profile v1 增加可选 `tools.webFetch` 类型；
2. 定义默认关闭和默认资源上限；
3. 实现 enabled、allowedHosts 与数值范围验证；
4. hostname 规范化、去重，拒绝 IP、通配符、协议、路径、端口和空值；
5. 把解析结果投影到冻结 AppConfig/SessionFactoryConfig；
6. 未配置和 `enabled=false` 时行为与 v0.2.6 完全相同；
7. 同步 env 开发入口，或在架构允许下明确 Profile 是本版唯一配置源；不得静默出现入口分叉；
8. 更新 config view/header 所需的安全摘要，但暂不注册 Tool。

停点：config-file、env config、setup/profile 回归、application/session-factory 相关测试和 typecheck 通过。

停止条件：需要破坏 Profile v1 旧文件、默认启用网络，或必须引入 config v2 才能表达语义。

## 4. Batch B：纯 URL、内容类型和展示策略

1. 定义 `WebFetchRequest/Result/Body` 与稳定内部错误码；
2. 实现 URL 长度、HTTPS、无凭据、非 IP、fragment 清理和精确 allowlist；
3. 实现显式端口/默认端口规范化与 same-origin 判断；
4. 实现 Content-Type 分类、charset 提取和 TextDecoder fail-closed；
5. 定义 Tool 参数 JSON schema，只有 `url` 且 `additionalProperties=false`；
6. 实现 Approval 脱敏摘要：保留 origin/path/query keys，删除 query values/fragment；
7. 实现 text 直出和 HTML→Markdown/GFM 转换；
8. 给输出加不可信外部资料 wrapper、元数据和最终字符上限；
9. `ToolSuccessDetails` 增加 `web_fetch` 成员，任何 exhaustiveness switch 同步处理；
10. 暂不进行 DNS 或网络请求。

停点：web policy、argument parsing、approval summary、HTML presentation、details 类型和 typecheck 通过。

停止条件：HTML 库许可证/ESM/Node 24 不合格，或转换结果无法可靠限制输出。

## 5. Batch C：公网地址判定

1. 选择并固定 IP 分类依赖；
2. 覆盖 IPv4 public/private/loopback/link-local/multicast/unspecified/documentation/reserved；
3. 覆盖 IPv6 global、loopback、ULA、link-local、multicast、unspecified；
4. IPv4-mapped IPv6 按嵌入 IPv4 分类；
5. 处理 IPv6 bracket；
6. 实现 `lookup(all:true, order:"verbatim")` 的窄 resolver；
7. 空结果、family 不一致、非法 IP fail closed；
8. 任一非公网答案导致整个域名失败；
9. 按 RFC 7050/6052 方向发现活动 DNS64 prefix，识别 NAT64 映射到非公网 IPv4；
10. DNS wait 与 Turn signal race，清理 listener，迟到结果不能继续执行。

停点：纯地址分类、resolver、DNS64/NAT64 和取消测试通过；不得访问系统真实 DNS。

停止条件：只处理 IPv4、忽略 mixed answer、无法证明 NAT64 行为，或准备把 DNS 全答案过滤成“挑一个能用的”。

## 6. Batch D：固定地址 HTTPS transport

1. 使用 per-request Undici Agent/dispatcher 或等价机制注入已验证 lookup；
2. 保持原 hostname 作为 Host 与 TLS SNI；
3. lookup callback 只能返回本次已验证地址集合，不能回退到系统 DNS；
4. 只发 GET，`redirect:"manual"`；
5. 只发送固定 User-Agent 与 Accept；
6. 不读取环境代理，不安装/修改 global dispatcher；
7. 请求失败前后均关闭私有 dispatcher；
8. signal 预取消时不得创建连接；
9. request abort 与普通 TLS/connection error 分类不同；
10. 验证引入 Undici 不改变 OpenAI/DeepSeek/Local Provider 现有网络测试。

停点：pinned lookup、Host/SNI、headers、dispatcher cleanup、cancel 和三 Provider 回归通过。

停止条件：连接仍可能二次解析、需要禁用 TLS 校验、需要全局 dispatcher，或必须使用 shell/curl。

## 7. Batch E：redirect、读取上限和 timeout

1. 组合 URL policy、resolver 与 pinned transport；
2. 手动处理 301/302/303/307/308；
3. 相对跳转同源时允许；跨源、协议降级、凭据、IP、非 allowlist 均拒绝；
4. 每个允许 hop 重新解析、验证和固定；
5. redirect response body 在继续或失败前取消；
6. 在下一 hop 前执行 maxRedirects 判定；
7. Content-Length 超限立即拒绝；
8. 无/错误/少报 Content-Length 时按实际 stream 限制；
9. 精确等于 byte cap 不误标；实际超限保留前缀并取消 reader；
10. charset 解码后执行 char cap；
11. 组合 Turn signal 与 provider timeout，可靠区分 `TURN_CANCELLED` 和 `WEB_FETCH_TIMEOUT`；
12. 所有 timer、reader、body、listener 和 dispatcher 在 settle 前清理。

停点：fetch service 的 redirect/size/charset/timeout/cancel/quiescence 测试和 typecheck 通过。

停止条件：依赖自动 redirect、一次只验证初始 URL、先完整 buffer 再限界，或取消后仍有 stream/connection 活动。

## 8. Batch F：Tool 与 Application 装配

1. 实现 `createWebFetchTool` 与单一 `web` capability；
2. permission 固定为 `network`；
3. describe 使用脱敏摘要，不触发 DNS；
4. execute 把现有 Turn signal 原样传入安全 fetch service；
5. transport result 转成有界、不可信 Tool content 和结构化 details；
6. SessionFactory 只在冻结配置 enabled 时注入 capability；
7. 现有 project-files capability 保持原顺序和行为；
8. Provider 不支持 Tool Calling 时不发送 Tool schema，也不暗中 fetch；
9. `never/ask/always` 按现有 Approval 契约执行；
10. Approval 后、DNS 前再次检查取消；
11. 网络失败不触发 model retry；模型可在当前 Tool Loop 根据结果决定是否继续，但 Runtime 不自动重放。

停点：ToolRuntime、Session、SessionFactory、prompt composition、Approval 和 Journal 专项测试通过。

停止条件：需要 ChatSession import 具体网络 Tool、需要新 Agent phase，或把 allowlist 判断放进 Approval UI。

## 9. Batch G：CLI 与 NDJSON 等价

实施状态（2026-09-13）：已完成第 1、3、4 项，并完成第 2、5 项所需的 Tool 脱敏摘要验证；CLI 与 NDJSON 均复用同一 SessionFactory 配置。Batch H 已开始，Profile NDJSON 离线启动测试已确认启用配置会声明 `webFetch: true`；网络 policy、DNS、固定地址 transport、redirect/大小/timeout/cancel、Tool 边界和 NDJSON 配置回归通过，Approval 摘要脱敏回归也已覆盖。全量离线回归通过：253 passed，4 skipped。

1. CLI header/help/config view 报告 web_fetch 状态；
2. Approval 文案显示脱敏目标；
3. NDJSON `ready.capabilities.webFetch` 采用可选兼容字段；
4. CLI 与 NDJSON 都从同一 SessionFactory 获得相同配置和 Tool；
5. NDJSON approval_request 不含 query values；
6. cancel 在 Approval、DNS、request、redirect 和 body read 阶段都得到唯一 `response_cancelled`；
7. `tool_start/tool_end` 事件顺序与现有协议一致；
8. 正常/非 2xx/blocked/timeout/cancel 都不产生第二终态；
9. stdout 保持纯 NDJSON；
10. 旧客户端忽略 `webFetch` 字段继续工作。

停点：CLI、protocol parser/runner、approval、cancel、stdout 和 ready capability 测试通过。

## 10. Batch H：离线全链路与安全回归

1. 使用临时 Profile、workspace、Session/Memory 和受控网络 seam 启动完整 NDJSON 路径；
2. 模型触发 allowlist URL，收到 Approval，批准后得到 HTML→Markdown 结果；
3. 验证 Tool Call/Result、details、Journal 和模型第二 step 可重建；
4. 拒绝 Approval，确认 DNS/transport 未调用；
5. 测试私网、mixed DNS、rebinding 尝试、跨源 redirect 和超限 stream；
6. 在 DNS/request/body 阶段分别取消，验证 quiescence 后唯一终态；
7. 新 Turn 正常执行，证明旧 signal 与旧地址集合不污染；
8. 扫描 stdout/stderr/diagnostics/Journal/临时 artifact 中的 query-secret、header-secret、body-secret 和 DNS 哨兵；
9. 运行 OpenAI/DeepSeek/Local、文件 Tool、Memory、Session 恢复和现有真实 NDJSON 测试的离线部分；
10. 检查依赖许可证、lockfile、构建与 pack 内容。

停点：全部 P0、离线门禁和 pack 检查通过。此时才能把 `ready.capabilities.webFetch` 标为 true。

## 11. Batch I：文档与用户授权的真实验收

1. 更新 README 的 Profile 示例、安全警告、Approval 和取消说明；
2. 更新 roadmap、references、DSH 参考评审、必要的 bugs/evaluation；
3. 明确 URL 与网页正文会进入私人 Session，但不会进入普通日志；
4. 记录 DSH 参考日期和实际锁定 commit；若实现时 master 已变化，重新评审差异；
5. 只有用户明确授权后，使用专用测试 Profile 与非敏感公开 HTTPS 文本页执行一次真实 smoke；
6. 真实 smoke 覆盖正常 fetch、同源 redirect（若稳定端点可用）、取消和后续 Turn；
7. 不把真实正文、query、DNS 结果或私人配置写入报告；
8. 记录测试数、skip、已知限制、Git 状态；未经明确要求不提交、不推送。

最终门禁：

```text
npm run typecheck
npm test
npm run build
npm run pack:check
git diff --check
```

## 12. 全局停止条件

出现任一情况必须停止并请求设计确认：

- 需要允许 HTTP、IP literal、跨源自动 redirect、凭据、自定义 header/body 或 proxy；
- 无法把通过校验的地址固定到实际连接；
- 需要修改全局 dispatcher 或影响 Provider SDK；
- NAT64 正确性无法在当前依赖和平台上建立可验证边界；
- 需要 Session v4、breaking NDJSON 事件或新的通用 Runtime 服务容器；
- HTML 转换或输出上限需要完整浏览器/DOM；
- 网络取消无法在终态前达到 quiescence；
- 默认离线测试需要访问公网或真实 DNS；
- 需要同时实现 web_search、Shell、缓存、spill 或后台任务。

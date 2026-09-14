# Isla v0.2.7 测试与验收：受控只读公网获取

## 1. 原则

默认测试完全离线。使用纯策略输入、注入 resolver、固定 lookup、mock dispatcher、受控 ReadableStream、fake timer、deferred/barrier、临时 Profile/workspace/Session/Memory 和 FakeProvider。禁止访问真实公网、真实 DNS、系统代理、真实 home、私人会话或真实 Key。

P0 是收口门禁。任一 P0 失败时：

- `web_fetch` 不得默认启用；
- `ready.capabilities.webFetch` 不得为 true；
- 不得执行真实联网 smoke；
- 不得声称 SSRF、DNS rebinding、取消或隐私边界完成。

测试不得用固定 sleep 证明竞态；必须能确定操作已经进入指定阶段后再批准、取消或释放。

## 2. 配置与启用

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| CFG-WEB-001 | P0 | 旧 Profile 无 tools | 成功解析，webFetch disabled，无 schema |
| CFG-WEB-002 | P0 | enabled=false | 忽略网络执行配置，不注册 Tool |
| CFG-WEB-003 | P0 | enabled=true + 合法 hosts | 冻结规范化配置并注册能力 |
| CFG-WEB-004 | P0 | enabled=true + 空 hosts | 启动前失败 |
| CFG-WEB-005 | P0 | hostname 大小写/IDN | 规范化为唯一 ASCII lowercase hostname |
| CFG-WEB-006 | P0 | 重复 hostname | 去重且顺序确定 |
| CFG-WEB-007 | P0 | host 含 scheme/path/port/wildcard | 配置失败 |
| CFG-WEB-008 | P0 | IPv4/IPv6 literal host | 配置失败 |
| CFG-WEB-009 | P0 | host 数量超过 32 | 配置失败 |
| CFG-WEB-010 | P0 | timeout/bytes/chars/output/redirect 边界 | 最小/最大接受，越界拒绝 |
| CFG-WEB-011 | P0 | unknown tools field | 沿用明确 warning，不静默生效 |
| CFG-WEB-012 | P0 | profileToAppConfig | 所有网络值准确投影且冻结 |
| CFG-WEB-013 | P0 | env 等价入口（若保留） | 与 Profile 默认和验证一致 |
| CFG-WEB-014 | P0 | config view | 只显示状态、host 数量和上限，无秘密 |

## 3. Tool 参数与 URL 纯策略

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| URL-001 | P0 | 非 JSON/非对象/缺 url | INVALID_ARGUMENTS，零 DNS |
| URL-002 | P0 | url 非字符串/空字符串 | INVALID_ARGUMENTS，零 DNS |
| URL-003 | P0 | additional property | schema/执行校验拒绝 |
| URL-004 | P0 | URL 超过 2048 | WEB_INVALID_URL，零 DNS |
| URL-005 | P0 | 非绝对 URL | WEB_INVALID_URL |
| URL-006 | P0 | http/ftp/file/data/javascript | WEB_INVALID_URL |
| URL-007 | P0 | username/password | WEB_BLOCKED_URL |
| URL-008 | P0 | IPv4、bracketed IPv6 literal | WEB_BLOCKED_URL |
| URL-009 | P0 | host 不在 allowlist | WEB_HOST_NOT_ALLOWED |
| URL-010 | P0 | 相似/后缀欺骗域名 | 不匹配，例如 allowed.example 不允许 allowed.example.evil |
| URL-011 | P0 | 父域/子域 | 不隐式互相允许 |
| URL-012 | P0 | IDN 同形显示 | 按规范 ASCII hostname 精确匹配 |
| URL-013 | P0 | fragment | 实际请求和结果移除 fragment |
| URL-014 | P0 | 默认 443 与显式 443 | origin 判断一致 |
| URL-015 | P0 | 非默认端口 | URL 可解析；redirect origin 必须端口一致 |
| URL-016 | P0 | query | 原请求保留，Approval/diagnostic 不显示 value |

## 4. Approval 摘要与权限

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| APR-WEB-001 | P0 | permission | 固定为 network |
| APR-WEB-002 | P0 | policy=never | PERMISSION_DENIED，零 URL/DNS/transport 副作用 |
| APR-WEB-003 | P0 | policy=ask + reject | USER_REJECTED，零 DNS/transport |
| APR-WEB-004 | P0 | policy=ask + approve | 批准后执行，且执行前重查 signal |
| APR-WEB-005 | P0 | policy=always | 执行但仍强制 allowlist/public-IP 策略 |
| APR-WEB-006 | P0 | summary 普通 URL | 显示 https origin/path |
| APR-WEB-007 | P0 | summary query/fragment | 仅 query keys；无 values/fragment |
| APR-WEB-008 | P0 | approve/cancel 竞态 | 最多一次决定，取消不记 USER_REJECTED |
| APR-WEB-009 | P0 | remembered/automatic approval 后取消 | DNS 前停止 |

## 5. IP 地址分类

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| IP-001 | P0 | 公网 IPv4 | public |
| IP-002 | P0 | 0/8、10/8、100.64/10、127/8 | blocked |
| IP-003 | P0 | 169.254/16、172.16/12、192.168/16 | blocked |
| IP-004 | P0 | multicast、broadcast、documentation、reserved | blocked |
| IP-005 | P0 | 公网 IPv6 global unicast | public |
| IP-006 | P0 | ::、::1、fe80::/10、fc00::/7、ff00::/8 | blocked |
| IP-007 | P0 | IPv6 documentation/reserved/transition ranges | 按明确策略 fail closed |
| IP-008 | P0 | IPv4-mapped public IPv6 | 按嵌入 IPv4 为 public |
| IP-009 | P0 | IPv4-mapped private IPv6 | blocked |
| IP-010 | P0 | bracketed IPv6 | 正确去 bracket 后分类 |
| IP-011 | P0 | malformed IP | blocked/fail closed |
| IP-012 | P0 | 大小写/压缩 IPv6 表示 | 同一分类 |

## 6. DNS 与 NAT64

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| DNS-001 | P0 | 单一公网 A | 返回可固定 IPv4 集合 |
| DNS-002 | P0 | 单一公网 AAAA | 返回可固定 IPv6 集合 |
| DNS-003 | P0 | 多个全公网答案 | 全部保留且顺序确定 |
| DNS-004 | P0 | 公网+私网 mixed answer | 整体 WEB_BLOCKED_URL，不挑公网继续 |
| DNS-005 | P0 | 空答案 | WEB_NETWORK_ERROR |
| DNS-006 | P0 | family 与 address 不一致 | fail closed |
| DNS-007 | P0 | resolver reject | WEB_NETWORK_ERROR，安全消息 |
| DNS-008 | P0 | signal 预取消 | 不调用 resolver |
| DNS-009 | P0 | lookup 等待中取消 | 立即结算 TURN_CANCELLED，listener 清理 |
| DNS-010 | P0 | lookup 取消后迟到 | 不创建 transport、不产生后续事件 |
| DNS-011 | P0 | RFC7050 无 DNS64 | 普通公网 IPv6 正常 |
| DNS-012 | P0 | 活动 RFC6052 各合法 prefix | 正确提取嵌入 IPv4 |
| DNS-013 | P0 | NAT64→公网 IPv4 | 可按策略继续 |
| DNS-014 | P0 | NAT64→private/loopback/link-local IPv4 | WEB_BLOCKED_URL |
| DNS-015 | P0 | malformed DNS64 discovery | 不误放行潜在非公网目标 |

## 7. 固定地址 transport

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| PIN-001 | P0 | validated 地址集合 | connector lookup 只返回该集合 |
| PIN-002 | P0 | family=4/6 选择 | 只返回匹配 family；无匹配明确失败 |
| PIN-003 | P0 | options.all | 返回复制后的完整 eligible 集合 |
| PIN-004 | P0 | DNS 校验后系统记录变化 | 实际连接仍只用已验证集合 |
| PIN-005 | P0 | hostname | HTTP Host/TLS SNI 保持原域名，不替换成 IP |
| PIN-006 | P0 | method/redirect | GET + manual |
| PIN-007 | P0 | headers | 只有固定 UA/Accept，无 Cookie/Auth/Referer |
| PIN-008 | P0 | 环境存在 HTTP_PROXY/HTTPS_PROXY/NO_PROXY | v0.2.7 行为不受影响 |
| PIN-009 | P0 | global dispatcher sentinel | 前后 identity/行为不变 |
| PIN-010 | P0 | request 成功/失败/取消 | 私有 dispatcher 各关闭一次 |
| PIN-011 | P0 | signal 预取消 | 不创建 Agent/连接 |
| PIN-012 | P0 | Undici 引入 | 三种 Model Provider 网络测试无回归 |

## 8. 重定向

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| REDIR-001 | P0 | 301/302/303/307/308 相对同源 | 允许并逐跳重验 |
| REDIR-002 | P0 | 300/304/305/306 | 作为最终非 redirect 响应 |
| REDIR-003 | P0 | redirect 无 Location | WEB_REDIRECT_BLOCKED/稳定失败，body 清理 |
| REDIR-004 | P0 | 非法 Location | 稳定失败，body 清理 |
| REDIR-005 | P0 | scheme downgrade 到 http | WEB_REDIRECT_BLOCKED |
| REDIR-006 | P0 | hostname/port 改变 | WEB_REDIRECT_BLOCKED，不请求目标 |
| REDIR-007 | P0 | redirect 注入 credentials | WEB_BLOCKED_URL |
| REDIR-008 | P0 | redirect 到 IP literal/非 allowlist | 在 DNS 前拒绝 |
| REDIR-009 | P0 | redirect hop mixed/private DNS | WEB_BLOCKED_URL |
| REDIR-010 | P0 | maxRedirects=0 | 不跟随首跳 |
| REDIR-011 | P0 | 恰好达到上限 | 允许规定数量，不多请求一跳 |
| REDIR-012 | P0 | 环路 | 在 hop 上限稳定结束 |
| REDIR-013 | P0 | 每 hop | 前一 body 和 dispatcher 在下一 hop 前清理 |
| REDIR-014 | P0 | redirect 期间 cancel | 不启动下一 hop，TURN_CANCELLED |

## 9. Content-Type 与 charset

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| MIME-001 | P0 | text/html 大小写/参数 | html |
| MIME-002 | P0 | application/xhtml+xml | html |
| MIME-003 | P0 | text/plain/css/csv | text |
| MIME-004 | P0 | application/json/xml | text |
| MIME-005 | P0 | vendor +json/+xml | text |
| MIME-006 | P0 | 缺 Content-Type | WEB_UNSUPPORTED_CONTENT_TYPE，body 清理 |
| MIME-007 | P0 | octet-stream/image/pdf/zip | WEB_UNSUPPORTED_CONTENT_TYPE |
| MIME-008 | P0 | charset 缺失 | UTF-8 |
| MIME-009 | P0 | quoted/mixed-case charset | 正确规范化解码 |
| MIME-010 | P0 | 支持的非 UTF-8 | 正确解码 |
| MIME-011 | P0 | 未知 charset | WEB_UNSUPPORTED_CONTENT_TYPE，读取前失败 |
| MIME-012 | P0 | HTML meta 与 header 冲突 | 只服从 header，不嗅探 |

## 10. 字节、字符与输出上限

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| CAP-001 | P0 | Content-Length 大于 byte cap | 读取前 WEB_FETCH_TOO_LARGE |
| CAP-002 | P0 | 非数字/负 Content-Length | 不信任声明，按 stream cap |
| CAP-003 | P0 | stream 小于 cap | 完整结果，truncated=false |
| CAP-004 | P0 | stream 恰好等于 cap+EOF | truncated=false |
| CAP-005 | P0 | 单 chunk 超 cap | 保留精确前缀，truncated=true |
| CAP-006 | P0 | 多 chunk 越过 cap | 总 bytes 不超限，reader 被取消 |
| CAP-007 | P0 | Content-Length 少报 | 实际 cap 仍生效 |
| CAP-008 | P0 | multibyte 字符跨 chunk | 字节拼接后统一正确解码 |
| CAP-009 | P0 | decoded 超 char cap | 裁剪并 truncated=true |
| CAP-010 | P0 | byte 和 char 均截断 | 单一 truncated=true，事实一致 |
| CAP-011 | P0 | HTML→Markdown 放大输出 | final output cap 生效 |
| CAP-012 | P0 | wrapper 元数据占用 | 总 Tool content 仍不超 maxOutputChars |
| CAP-013 | P0 | 空 body | 返回有元数据的空正文结果 |
| CAP-014 | P1 | surrogate/combining 边界 | 不抛错；文档化当前 JS 字符裁剪语义 |

## 11. HTTP 结果语义与展示

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| OUT-001 | P0 | 200 text | final URL/status/type/body 完整 |
| OUT-002 | P0 | 404/429/500 文本 | ok Tool result，状态码保留，不转 network error |
| OUT-003 | P0 | HTML | 转 Markdown/GFM，不执行脚本/加载子资源 |
| OUT-004 | P0 | text/json/xml | 不做 HTML 转换 |
| OUT-005 | P0 | Tool wrapper | 明确“不可信外部资料”与权限边界 |
| OUT-006 | P0 | truncated | 用户/模型可见明确标记 |
| OUT-007 | P0 | details | 与 transport 权威结果一致 |
| OUT-008 | P0 | display 文本被篡改 fixture | Runtime 不从文本反向恢复 details |
| OUT-009 | P0 | 网页含 prompt injection | 只作为不可信 content，不能绕过 ToolRuntime permission |
| OUT-010 | P0 | final URL query | 模型结果按契约保留；diagnostic/Approval 不泄露值 |

## 12. 错误分类

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| ERR-WEB-001 | P0 | URL parse/scheme | WEB_INVALID_URL |
| ERR-WEB-002 | P0 | allowlist miss | WEB_HOST_NOT_ALLOWED |
| ERR-WEB-003 | P0 | private/mixed/NAT64 | WEB_BLOCKED_URL |
| ERR-WEB-004 | P0 | redirect policy | WEB_REDIRECT_BLOCKED |
| ERR-WEB-005 | P0 | declared too large | WEB_FETCH_TOO_LARGE |
| ERR-WEB-006 | P0 | MIME/charset | WEB_UNSUPPORTED_CONTENT_TYPE |
| ERR-WEB-007 | P0 | provider deadline | WEB_FETCH_TIMEOUT |
| ERR-WEB-008 | P0 | DNS/TLS/connection/read fault | WEB_NETWORK_ERROR |
| ERR-WEB-009 | P0 | Turn signal | TURN_CANCELLED |
| ERR-WEB-010 | P0 | arbitrary internal error | 安全 EXECUTION_FAILED，无原始对象泄露 |
| ERR-WEB-011 | P0 | network/timeout | 不触发 model retry 或 Tool 自动重放 |

## 13. Timeout、取消与 quiescence

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| CAN-WEB-001 | P0 | signal 预取消 | 零 URL side effect 之后立即 TURN_CANCELLED |
| CAN-WEB-002 | P0 | Approval 等待取消 | 沿用 v0.2.6；零 DNS |
| CAN-WEB-003 | P0 | DNS 等待取消 | listener 清理，迟到 DNS 不连接 |
| CAN-WEB-004 | P0 | TLS/request 等待取消 | request abort，dispatcher 关闭 |
| CAN-WEB-005 | P0 | body read 取消 | reader/body/dispatcher 清理 |
| CAN-WEB-006 | P0 | redirect 间取消 | 不启动下一 hop |
| CAN-WEB-007 | P0 | provider timeout 先发生 | WEB_FETCH_TIMEOUT，不是 TURN_CANCELLED |
| CAN-WEB-008 | P0 | Turn cancel 先发生 | TURN_CANCELLED，不是 WEB_FETCH_TIMEOUT |
| CAN-WEB-009 | P0 | timeout/cancel 同时竞争 | 第一可证明原因，只有一个终态 |
| CAN-WEB-010 | P0 | fetch 成功/cancel 竞争 | 单一 settlement；取消胜出时不继续模型 step |
| CAN-WEB-011 | P0 | 重复 cancel | 幂等，无重复 Tool/Turn 终态 |
| CAN-WEB-012 | P0 | response_cancelled 后 | 无 DNS、网络、tool_end 或 Provider 后续事件 |
| CAN-WEB-013 | P0 | whenIdle | 所有 cleanup 和终态保存后才完成 |
| CAN-WEB-014 | P0 | 下一 Turn | 新 signal、新地址集合、新 dispatcher，无旧状态污染 |
| CAN-WEB-015 | P0 | cancelled Session 恢复 | 不重放 web_fetch |

## 14. Session、Journal 与上下文

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| J-WEB-001 | P0 | Tool Call 发出 | arguments 在模型消息事实中可重建 |
| J-WEB-002 | P0 | Tool 成功 | Tool Result/details 与下一模型请求一致 |
| J-WEB-003 | P0 | Tool blocked/failed | 稳定 code，模型不能看到原始异常 |
| J-WEB-004 | P0 | fetch 后完成 Turn | assistant 仅在完整回答后保存 |
| J-WEB-005 | P0 | fetch 中取消 | user 保留、无 assistant、Attempt aborted、Turn cancelled |
| J-WEB-006 | P0 | Tool 已完成后取消 | 已完成 action 保留，不继续 Provider step |
| J-WEB-007 | P0 | Snapshot | 只记录实际发送请求，不伪造 retry/replay |
| J-WEB-008 | P0 | 旧 v1/v2/v3 Session | 兼容读取；无网络配置时不改变行为 |
| J-WEB-009 | P0 | Context compaction | Tool Call/Result 配对和现有边界不破坏 |
| J-WEB-010 | P0 | projectSources | 不因 web details 污染现有项目来源投影 |

## 15. Application、CLI 与 NDJSON

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| APP-WEB-001 | P0 | disabled config | Application/Session 无 web capability |
| APP-WEB-002 | P0 | enabled config | 唯一 SessionFactory 注入 project-files + web |
| APP-WEB-003 | P0 | 多 Session | 共享冻结配置，不共享 Turn signal/dispatcher |
| APP-WEB-004 | P0 | create/close | 不遗留 timer、listener、connection resource |
| CLI-WEB-001 | P0 | header/help | 状态准确，无完整 allowlist/秘密 |
| CLI-WEB-002 | P0 | Approval reject/approve | 与 ToolRuntime 策略一致 |
| CLI-WEB-003 | P0 | Ctrl+C 各 fetch 阶段 | 回到输入且无迟到输出 |
| ND-WEB-001 | P0 | ready disabled | webFetch=false/缺省兼容值 |
| ND-WEB-002 | P0 | ready enabled | webFetch=true 仅在完整能力可用时 |
| ND-WEB-003 | P0 | approval_request | URL 摘要脱敏，id 关联正确 |
| ND-WEB-004 | P0 | approval reject | tool_end 失败/模型后续语义与现有协议一致 |
| ND-WEB-005 | P0 | approval approve | tool_start/tool_end/response_end 顺序稳定 |
| ND-WEB-006 | P0 | cancel | cancel_ack + 唯一 response_cancelled |
| ND-WEB-007 | P0 | blocked/timeout/network | 唯一稳定终态，无协议正文泄露 |
| ND-WEB-008 | P0 | stdout | 每行合法 NDJSON，HTML newline 正确 JSON escape |
| ND-WEB-009 | P0 | 旧客户端 | 忽略 capability 新字段仍可对话/退出 |
| ND-WEB-010 | P0 | new_session | 新 Session 保持相同 web 配置与干净 Turn 状态 |

## 16. 隐私与供应链

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| PRIV-WEB-001 | P0 | URL query secret sentinel | 不在 Approval、stderr、diagnostic、Journal action 出现 |
| PRIV-WEB-002 | P0 | response body secret sentinel | 不在日志/协议元数据/CI artifact；仅出现在必要 Tool message |
| PRIV-WEB-003 | P0 | header/cookie/proxy env sentinel | 请求未发送，输出未记录 |
| PRIV-WEB-004 | P0 | DNS address sentinel | 普通/调试诊断不输出完整答案集 |
| PRIV-WEB-005 | P0 | thrown cause 含 secret | 公共错误只含安全稳定消息 |
| PRIV-WEB-006 | P0 | Authorization/Cookie assertion | 所有实际 hop 都不存在 |
| DEP-WEB-001 | P0 | 新依赖 | 锁定、MIT-compatible、Node 24/ESM 可用 |
| DEP-WEB-002 | P0 | npm pack | 不包含测试 fixture、网页正文、证书、临时文件 |
| DEP-WEB-003 | P0 | global dispatcher | 未被依赖初始化或 Tool 改写 |
| DEP-WEB-004 | P0 | npm audit/已知风险检查 | 结果记录；高危相关问题阻断收口 |

## 17. 离线全链路验收

使用临时 Profile、workspace、Session/Memory、FakeProvider 与受控 network seam：

1. 启动 NDJSON，确认 `webFetch=true`、toolCalling/cancellation 既有字段不变；
2. prompt 让模型调用 allowlist 内 URL；
3. 收到脱敏 approval_request，拒绝一次，证明 resolver/transport 未运行；
4. 新 Turn 再次调用并批准；
5. 受控 HTTPS response 返回 HTML，验证 Markdown、status、final URL、details、truncated；
6. 模型第二 step 基于 Tool Result 完成回答，Session 可完整重建；
7. 分别执行 private DNS、mixed DNS、same-origin redirect、cross-origin redirect、binary MIME、oversize stream；
8. 在 DNS 和 body read 两个阶段发送 cancel，确认 quiescence 后唯一 response_cancelled；
9. 新 Session/新 Turn 正常 fetch，证明旧 signal、地址和 dispatcher 无污染；
10. exit，确认所有 writer、timer、stream 和 dispatcher 已结算后 bye；
11. 扫描 stdout、stderr、diagnostic、Journal 和临时 artifact 的四类 secret sentinel；
12. 清理全部临时资源。

离线 E2E 不得通过放宽生产 SSRF 策略来访问 loopback。可使用注入的测试 resolver/transport 或 mock dispatcher；测试 seam 不进入 Profile、模型 schema 或公共 Runtime API。

## 18. 用户授权的真实联网验收

只在用户明确授权后运行，使用专用 Profile、无敏感 query 的公开 HTTPS 文本目标和最小 allowlist：

1. 启动真实 CLI 或 NDJSON；
2. 确认目标 hostname 精确命中 allowlist；
3. Approval 后成功获取并生成回答；
4. 若稳定端点允许，验证一次同源 redirect；
5. 对一个慢响应执行 cancel，确认唯一取消终态与后续 Turn；
6. 正常 exit；
7. 报告只记录域名、稳定 code、耗时、bytes/chars 和通过状态，不记录 query、正文、DNS 地址或私人配置。

真实 smoke 不替代任何离线 P0，也不进入默认 `npm test` 或 CI。

## 19. 回归矩阵

必须覆盖：

- OpenAI、DeepSeek、Local Provider generate/generateWithTools 与 signal；
- 文件 list/read/search/write、Sandbox、Approval；
- Memory、Context、Checkpoint、Session v1/v2/v3、Journal；
- CLI 普通对话、双 Ctrl+C、config/setup；
- NDJSON prompt/approval/cancel/new_session/exit 和 stdout 纯度；
- projectSources provenance；
- ApplicationContext 创建失败、close 顺序和幂等；
- build、pack、Windows/Linux/macOS 可执行路径。

## 20. 最终门禁

```text
npm run typecheck
npm test
npm run build
npm run pack:check
git diff --check
```

收口报告必须记录：

- 总测试通过/跳过/失败数；
- 全部 P0 状态；
- DNS 全答案、NAT64、connection pinning 和 redirect 证明；
- timeout/cancel/quiescence 证明；
- Approval 与隐私哨兵扫描；
- 新依赖、许可证、pack 内容；
- 三 Provider 和既有 Tool 回归；
- 真实联网是否获得授权、是否执行；
- Git 状态和已知限制。

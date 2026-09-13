# Isla v0.2.7.1 测试与验收：Agent Loop 澄清与规划修复

## 1. 原则

默认测试完全离线。使用 FakeProvider、Fake Tool、受控 Web fixture、临时 Session/Memory、fake timer 和 deferred/barrier。不得依赖真实模型恰好遵守 Prompt，也不得访问真实公网、DNS、Profile、私人 Session 或 Key。

测试必须同时证明两件事：

1. 模型按预期输出时，流程能完成复杂任务；
2. 模型尝试越过阶段时，Runtime 不会暴露或执行不应存在的 Tool。

P0 任一失败时不得声称 v0.2.7.1 完成。竞态测试禁止使用固定 sleep，必须先确认操作已经进入目标阶段再取消或释放。

## 2. 决策结构与解析

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| DEC-001 | P0 | 合法 answer | 解析 text 与 TaskBrief |
| DEC-002 | P0 | 合法 clarify | 解析 1–4 个非空问题 |
| DEC-003 | P0 | 合法 execute | 解析非空 objective，不含 ToolCall |
| DEC-004 | P0 | 非 JSON/array/null | 稳定解析失败 |
| DEC-005 | P0 | Markdown fence/前后解释 | 拒绝，不宽松截取 JSON |
| DEC-006 | P0 | unknown kind | 拒绝 |
| DEC-007 | P0 | 分支缺字段/混用字段 | 拒绝 |
| DEC-008 | P0 | clarify 0 个或超过 4 个问题 | 拒绝 |
| DEC-009 | P0 | 空白 text/question/objective | 拒绝 |
| DEC-010 | P0 | TaskBrief 数组/字符超限 | 拒绝 |
| DEC-011 | P0 | confirmed source 指向 user | 接受 |
| DEC-012 | P0 | source 越界或指向 system/assistant/tool | 拒绝 |
| DEC-013 | P0 | assumption 与 confirmed 分开 | 结构保持，不自动合并 |
| DEC-014 | P0 | 原始 decision 含秘密哨兵且失败 | 公共错误/diagnostic 不回显 |

## 3. understand 阶段隔离

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| UND-001 | P0 | capability 已启用 | 首次调用使用 generate，不使用 generateWithTools |
| UND-002 | P0 | 捕获首次 ModelRequest | `tools` 缺失 |
| UND-003 | P0 | Prompt registry | 包含 identity/runtime/decision，不含 capabilities |
| UND-004 | P0 | 模型文本伪造 Tool Call JSON | 仅按 decision 校验，不调用 ToolRuntime |
| UND-005 | P0 | answer decision | 提交一次 assistant，Turn completed |
| UND-006 | P0 | clarify decision | 零 Tool，Turn needs_user |
| UND-007 | P0 | execute decision | 仅校验成功后进入 execute_tools |
| UND-008 | P0 | user 消息顺序 | Provider 调用前已保存 user |
| UND-009 | P0 | Memory 含旅行条件 | 不直接成为 confirmed constraint |
| UND-010 | P0 | 不启用 Tool 的 Session | 保留 legacy 单次 generate 行为 |

## 4. 澄清行为

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| CLR-001 | P0 | 模糊重庆→广州自驾请求 | 只产生关键问题，无 D1–D5 路线 |
| CLR-002 | P0 | 缺天数/日期/预算/驾驶约束 | 最多四问，可合并相关项 |
| CLR-003 | P0 | 澄清文本 | 无具体站点、价格、里程、时长方案 |
| CLR-004 | P0 | clarify commit | assistant 问题进入 Session messages |
| CLR-005 | P0 | Turn 记录 | status=needs_user、endedAt 和 assistantMessageIndex 有效 |
| CLR-006 | P0 | `whenIdle()` | clarify 返回后无后台 promise/timer/Tool |
| CLR-007 | P0 | 用户补充天数和预算 | 新 Turn 看到原目标、问题和补充 |
| CLR-008 | P0 | 用户部分补充 | 可再次 clarify，但只问剩余关键项 |
| CLR-009 | P0 | 用户明确切换任务 | 新 TaskBrief 不继承旧任务约束 |
| CLR-010 | P0 | 新 Session | 无旧 TaskBrief 或澄清状态 |

## 5. TaskBrief 与事实分类

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| TASK-001 | P0 | goal | 忠实表达当前用户目标 |
| TASK-002 | P0 | 用户说“5天” | confirmed 并指向该 user 消息 |
| TASK-003 | P0 | 模型自行选择每日 6 小时驾驶 | assumption，不是 confirmed |
| TASK-004 | P0 | Tool 返回道路信息 | 不写入 confirmedConstraints |
| TASK-005 | P0 | 计算得到总预算 | 标记 estimate，不冒充用户条件或 Tool 原文 |
| TASK-006 | P0 | Session 中没有“国庆” | 任何 confirmed constraint 不得引用它 |
| TASK-007 | P0 | source index 合法但语义可疑 fixture | 记录可审计来源；测试不宣称 Runtime 能做语义证明 |
| TASK-008 | P0 | 有效新 decision | 原子替换当前 TaskBrief |
| TASK-009 | P0 | decision 失败/取消 | 不用半成品覆盖已有 TaskBrief |
| TASK-010 | P0 | TaskBrief 注入后续阶段 | 标签保持 confirmed/open/assumption |

## 6. Decision repair

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| REP-001 | P0 | 首次合法 | 一次 understand 调用，无 repair |
| REP-002 | P0 | 首次非法、修复合法 | 总计两次无 Tool Provider 调用 |
| REP-003 | P0 | 两次均非法 | Turn failed，零 Tool、零 assistant commit |
| REP-004 | P0 | 首次非法后取消 | 不启动 repair或 repair 立即取消，取决于 barrier 顺序；无 Tool |
| REP-005 | P0 | repair 请求 | 仍无 tools/capability instructions |
| REP-006 | P0 | Journal | repairAttempted 与两个真实 Attempt 一致 |
| REP-007 | P0 | modelRetries=1 | decision repair 次数不被网络 retry 倍增成开放循环 |

## 7. execute_tools 门控

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| EXE-001 | P0 | answer/clarify | generateWithTools 和 ToolRuntime 调用均为零 |
| EXE-002 | P0 | 有效 execute | 请求包含 tools 与 capabilities |
| EXE-003 | P0 | execute request | 包含已校验 TaskBrief 和 objective |
| EXE-004 | P0 | 多轮 Tool Calls | 按现有上限逐轮执行并保存消息 |
| EXE-005 | P0 | Tool Call/Result | 实际发送内容可由 Session 重建 |
| EXE-006 | P0 | 模型首轮停止 Tool | 不直接 completed，进入 synthesize |
| EXE-007 | P0 | Tool 成功后停止 | 进入 synthesize，不提交中间 assistant 文本 |
| EXE-008 | P0 | 重复 Tool 失败 | 沿用保护并把限制交给 synthesize |
| EXE-009 | P0 | 达到 Tool round 上限 | 不再调用 Tool，进入受限 synthesize |
| EXE-010 | P0 | Tool 尝试扩大 web allowlist | 仍由 v0.2.7 策略拒绝 |

## 8. synthesize 强制边界

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| SYN-001 | P0 | execute_tools 正常结束 | 必须额外调用一次 generate |
| SYN-002 | P0 | synthesize request | 不含 tools/capability instructions |
| SYN-003 | P0 | synthesize 输入 | 包含 TaskBrief、objective、Tool Call/Result 和限制 |
| SYN-004 | P0 | 中间 Tool response 带回答文本 | 不作为最终 assistant 提交 |
| SYN-005 | P0 | 完整旅行 fixture | 输出与确认总天数一致的每日安排 |
| SYN-006 | P0 | 用户条件 | 与 assumptions 分区或明确措辞区分 |
| SYN-007 | P0 | 外部路线/景点事实 | 只基于可见 Tool Result |
| SYN-008 | P0 | 里程/时间/价格 | 明确为 Tool 事实或估算，不混淆 |
| SYN-009 | P0 | 无足够证据 | 缩小结论范围，不编造具体数字 |
| SYN-010 | P0 | Tool Approval 被拒 | 解释限制；有用则受限交付，否则 blocked |
| SYN-011 | P0 | synthesize 空文本 | failed，不提交 assistant |
| SYN-012 | P0 | project source citation | 沿用现有清理和投影 |

## 9. 完整多轮旅行场景

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| TRIP-001 | P0 | 首轮模糊目标 | clarify、零 Tool |
| TRIP-002 | P0 | 补充总天数和预算 | 继续原目标，不要求重述 |
| TRIP-003 | P0 | 仍缺显著约束 | 只追问剩余约束或显式列为待确认 |
| TRIP-004 | P0 | 条件充分 | execute 决策成立 |
| TRIP-005 | P0 | 官方路线和景点 fixtures | 多轮 Tool 获取并保存证据 |
| TRIP-006 | P0 | 最终交付 | 完整逐日路线、驾驶安排、景点、住宿区域、预算和风险 |
| TRIP-007 | P0 | 不存在的历史条件 | 不出现“与你此前条件匹配”等错误声称 |
| TRIP-008 | P0 | 未确认偏好 | 明确标为假设/可调整项 |
| TRIP-009 | P0 | Tool 数据不足 | 不生成伪精确里程、时长和价格 |
| TRIP-010 | P0 | 追加修改要求 | 基于当前任务继续，不重新联网除非 decision=execute |

## 10. 取消与 quiescence

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| CAN-AG-001 | P0 | understand 等待中取消 | Attempt aborted、Turn cancelled、零 Tool/assistant |
| CAN-AG-002 | P0 | repair 等待中取消 | 不进入 execute/clarify/answer |
| CAN-AG-003 | P0 | Approval 等待中取消 | 沿用现有语义，不进入 synthesize |
| CAN-AG-004 | P0 | Tool Provider step 等待中取消 | 无下一 Tool round/synthesize |
| CAN-AG-005 | P0 | Tool execute 等待中取消 | 清理完成，唯一 cancelled |
| CAN-AG-006 | P0 | synthesize 等待中取消 | Tool 事实保留，无最终 assistant |
| CAN-AG-007 | P0 | phase 切换边界取消 | 下一阶段调用数为零 |
| CAN-AG-008 | P0 | 重复 cancel | 幂等、唯一终态 |
| CAN-AG-009 | P0 | `whenIdle()` | 终态保存和所有清理后返回 |
| CAN-AG-010 | P0 | 取消后简单新任务 | 使用新 signal 正常 answer |
| CAN-AG-011 | P0 | 取消后新复杂任务 | 不重放旧 objective/Tool/synthesize |
| CAN-AG-012 | P0 | CLI/NDJSON | 无迟到输出、重复 response_end 或 tool_end |

## 11. Session、Journal、Context 与恢复

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| J-AG-001 | P0 | phase 推进 | Journal action 顺序与实际请求一致 |
| J-AG-002 | P0 | decision | 只记录 kind/repair，不记录思维链或原始正文 |
| J-AG-003 | P0 | promptVersion | 不再固定错误的 `v0` |
| J-AG-004 | P0 | needs_user | 可引用非空 clarify assistant |
| J-AG-005 | P0 | blocked | 可引用用户可见阻断说明 |
| J-AG-006 | P0 | cancelled/failed | 不引用未提交 assistant |
| J-AG-007 | P0 | Session state | TaskBrief 可选字段往返一致 |
| J-AG-008 | P0 | 旧 Session | 无 TaskBrief 时兼容读取 |
| J-AG-009 | P0 | needs_user 后关闭/恢复 | 用户补充后继续原任务 |
| J-AG-010 | P0 | cancelled Session 恢复 | 不重放阶段 |
| J-AG-011 | P0 | compaction | confirmed/open/assumption 分类保持 |
| J-AG-012 | P0 | sourceMessageIndex + compaction | 不指向错误角色或重排消息 |
| J-AG-013 | P0 | request snapshot | 每个真实 Provider 请求均可审计 |
| J-AG-014 | P0 | assistant commit | 只有 clarify、answer、blocked explanation 或有效 synthesize 可提交 |

## 12. CLI、NDJSON 与事件顺序

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| CLI-AG-001 | P0 | clarify | 正常显示问题并返回输入提示 |
| CLI-AG-002 | P0 | 用户回答 | 延续原任务，无新命令要求 |
| CLI-AG-003 | P0 | 各阶段 Ctrl+C | 一条取消反馈，随后可继续 |
| CLI-AG-004 | P0 | simple answer | 用户可见行为不退化 |
| ND-AG-001 | P0 | clarify | 单一 response_end/outcome=needs_user |
| ND-AG-002 | P0 | execute | tool_start/tool_end 后才有最终 response_end |
| ND-AG-003 | P0 | synthesize | 不暴露 decision JSON 为 assistant chunk |
| ND-AG-004 | P0 | cancel | cancel_ack + 唯一 response_cancelled |
| ND-AG-005 | P0 | new_session | TaskBrief 和 phase 状态干净 |
| ND-AG-006 | P0 | stdout | 每行合法 NDJSON，无诊断或原始控制文本 |
| ND-AG-007 | P0 | 旧客户端 | 可忽略新增 outcome/事件信息并继续工作 |

v0.2.7.1 默认不新增公开 phase streaming 事件。若实现需要让 CLI/NDJSON 展示 phase，必须先设计协议兼容性；Journal 内部 phase action 不等于公共协议事件。

## 13. Provider 与 Tool 回归

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| REG-001 | P0 | OpenAI generate/generateWithTools | 两条路径与 signal 正常 |
| REG-002 | P0 | DeepSeek generate/generateWithTools | 两条路径与 signal 正常 |
| REG-003 | P0 | Local generate/generateWithTools | 两条路径与 signal 正常 |
| REG-004 | P0 | 文件 list/read/search/write | ToolRuntime、Approval、证据无回归 |
| REG-005 | P0 | v0.2.7 web_fetch | SSRF、DNS、HTTPS、redirect、上限、取消无回归 |
| REG-006 | P0 | Tool disabled | schema 不注册，legacy 对话正常 |
| REG-007 | P0 | Memory retrieval | 仍是不可信 Host context |
| REG-008 | P0 | Context checkpoint | 历史重建和来源不退化 |
| REG-009 | P0 | retry | 只重试既有可恢复 Provider 错误 |
| REG-010 | P0 | projectSources | provenance 不被 TaskBrief 污染 |

## 14. 隐私与安全

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| PRIV-AG-001 | P0 | decision 原文含 secret sentinel | diagnostic/Journal action/协议不回显 |
| PRIV-AG-002 | P0 | TaskBrief | 不保存 API Key、令牌或工具原始异常 |
| PRIV-AG-003 | P0 | Memory 条件 | 不提升为用户确认事实 |
| PRIV-AG-004 | P0 | Tool content prompt injection | 不能改变 synthesize Tool 权限或阶段 |
| PRIV-AG-005 | P0 | synthesize 无 tools | 网页内容无法诱导新增 Tool Call |
| PRIV-AG-006 | P0 | Web allowlist/Approval | decision 不能覆盖宿主策略 |
| PRIV-AG-007 | P0 | 测试 artifact | 不包含私人会话、真实 URL query 或 Key |

## 15. 离线全链路验收

使用脚本化 FakeProvider、Fake Web Tool 和临时 Session：

1. 启动启用 Tool Calling 的 Session；
2. 输入模糊重庆→广州自驾目标；
3. 捕获 understand 请求，断言零 tools；
4. FakeProvider 返回 clarify；
5. 断言 questions 被提交、Turn needs_user、Tool 调用为零；
6. 输入天数、预算、日期、驾驶员和偏好；
7. FakeProvider 返回带合法来源索引的 execute；
8. 执行至少两轮 Tool fixture，模拟官方路线和景点资料；
9. Tool Loop 停止后捕获 synthesize 请求，断言零 tools；
10. 返回完整逐日行程，检查天数、预算、事实、假设、估算和风险表达；
11. 扫描结果，不得出现 fixture 未提供的“此前条件”；
12. 保存并恢复一个 needs_user Session，继续完成任务；
13. 分别在 understand、Tool 和 synthesize barrier 取消，验证 quiescence；
14. 取消后执行一个简单新任务；
15. 扫描 stdout、stderr、diagnostic、Journal action 和临时 artifact 的秘密哨兵；
16. 清理临时资源。

该 E2E 验证控制流，不用对自然语言全文做脆弱快照。内容断言使用结构、必需段落、天数一致性、禁止短语、Provider/Tool 调用次数和来源集合。

## 16. 用户授权的真实联网验收

只在用户明确授权后运行：

1. 使用临时专用 Profile、最小 allowlist 和无敏感 query 的公开 HTTPS 目标；
2. 首轮模糊请求必须只澄清，网络 resolver/transport 计数为零；
3. 补充约束后允许真实 Web Tool 和 Approval；
4. 观察是否发生多轮查证及强制 synthesize；
5. 检查完整逐日方案和事实类别；
6. 对 understand、fetch、synthesize 至少选择可控阶段做取消 smoke；
7. 取消后发起新任务；
8. 退出并清理临时 Profile/Session；
9. 报告只记录结构性结果、稳定错误码和必要域名，不复制私人对话或网页正文。

真实评估不替代离线 P0，不进入默认 `npm test` 或 CI。

## 17. 最终门禁

```text
npm run typecheck
npm test
npm run build
npm run pack:check
git diff --check
```

收口报告必须包含：

- 总测试通过/跳过/失败数；
- 全部 P0 状态；
- understand 无 Tool、clarify 零 Tool、execute 门控和 synthesize 无 Tool 的请求证据；
- 多轮旅行闭环与事实分类结果；
- decision repair 上限；
- 各阶段取消、唯一终态和 quiescence；
- Session/Journal/Context 恢复与旧数据兼容；
- 三 Provider、既有 Tool、Web Tool、CLI 与 NDJSON 回归；
- 隐私哨兵扫描；
- 真实联网是否获得授权、是否执行；
- Git 状态和已知限制。


# Isla v0.2.6 测试与验收：端到端取消

## 1. 原则

默认完全离线。使用 FakeProvider、deferred promise、本地受控HTTP服务、临时workspace、临时Session/Memory和可注入终端信号。禁止使用真实Key、真实home、真实会话或固定sleep模拟取消竞态。

P0为收口门禁；P0失败不得把 `ready.capabilities.cancellation` 标为true。

## 2. Turn控制

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| CAN-001 | P0 | 空闲cancel | 返回false/no-op，下一Turn不受影响 |
| CAN-002 | P0 | 活动cancel | signal被abort，第一原因保留 |
| CAN-003 | P0 | 重复cancel | 幂等，无重复终态 |
| CAN-004 | P0 | 下一Turn | 使用全新未取消signal |
| CAN-005 | P0 | 并发send | fail closed，不创建第二活动Turn |
| CAN-006 | P0 | whenIdle | 只在活动和终态持久化均结算后完成 |
| CAN-007 | P0 | 成功/cancel竞态 | 只有一个终态 |
| CAN-008 | P0 | cancelled后Provider迟到文本 | 不提交assistant |

## 3. Provider

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| PROV-CAN-001 | P0 | signal预先取消 | 不调用HTTP/SDK |
| PROV-CAN-002 | P0 | generate等待中取消 | TURN_CANCELLED，不重试 |
| PROV-CAN-003 | P0 | generateWithTools取消 | 同一语义 |
| PROV-CAN-004 | P0 | OpenAI适配器 | signal传到底层调用 |
| PROV-CAN-005 | P0 | DeepSeek适配器 | signal传到底层调用 |
| PROV-CAN-006 | P0 | Local适配器 | signal传到底层调用 |
| PROV-CAN-007 | P0 | timeout/network/auth | 既有分类无回归 |

## 4. Approval

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| APR-CAN-001 | P0 | CLI等待审批时取消 | promise结算、监听器移除、raw mode恢复 |
| APR-CAN-002 | P0 | NDJSON等待审批时取消 | pending清除，无Tool执行 |
| APR-CAN-003 | P0 | 迟到approval_response | UNEXPECTED_APPROVAL |
| APR-CAN-004 | P0 | remembered approval后取消 | 副作用前仍检查signal |
| APR-CAN-005 | P0 | cancel/approve竞态 | 最多一次决定且取消不记USER_REJECTED |

## 5. Tool

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| TOOL-CAN-001 | P0 | execute前取消 | Tool函数不调用 |
| TOOL-CAN-002 | P0 | describe后取消 | 不进入Approval或副作用 |
| TOOL-CAN-003 | P0 | Approval后取消 | 写入前停止 |
| TOOL-CAN-004 | P0 | 长Tool协作取消 | 使用同一signal并安静结算 |
| TOOL-CAN-005 | P0 | Tool已完成后取消 | 保留真实Tool事实，不继续模型步骤 |
| TOOL-CAN-006 | P0 | 多Tool批次 | 取消后剩余Tool不启动 |
| TOOL-CAN-007 | P0 | 文件Tool | 不在cancelled终态后继续写入 |

## 6. 消息、Journal与恢复

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| J-CAN-001 | P0 | Provider阶段取消 | user保留，无assistant |
| J-CAN-002 | P0 | 活动Attempt | 状态aborted且有endedAt |
| J-CAN-003 | P0 | Turn终态 | cancelled、endedAt、稳定原因 |
| J-CAN-004 | P0 | Tool后取消 | 已完成action保留，未完成不伪造成功 |
| J-CAN-005 | P0 | 重启恢复 | cancelled Turn不重放 |
| J-CAN-006 | P0 | 崩溃running恢复 | 仍为interrupted，不误记cancelled |
| J-CAN-007 | P0 | v1/v2/v3旧文件 | 继续兼容读取与保存 |
| J-CAN-008 | P0 | Snapshot | 只记录实际发送请求，不生成取消后伪请求 |

## 7. NDJSON

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| ND-CAN-001 | P0 | 合法cancel | cancel_ack accepted=true |
| ND-CAN-002 | P0 | 空闲cancel | NOT_ACTIVE，未来prompt正常 |
| ND-CAN-003 | P0 | target不匹配 | NOT_ACTIVE，不取消当前请求 |
| ND-CAN-004 | P0 | 活动prompt取消 | 最终response_cancelled |
| ND-CAN-005 | P0 | 唯一终态 | 无response_end或error重复终态 |
| ND-CAN-006 | P0 | Approval期间取消 | pending清除，无写入 |
| ND-CAN-007 | P0 | EOF | disconnect取消并等待quiescence |
| ND-CAN-008 | P0 | exit活动请求 | shutdown取消后才bye |
| ND-CAN-009 | P0 | ready | cancellation=true且旧客户端可忽略 |
| ND-CAN-010 | P0 | stdout | 全部为合法NDJSON，stderr不含正文/Key |

## 8. CLI

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| CLI-CAN-001 | P0 | 空闲Ctrl+C | 明确退出，未创建取消状态 |
| CLI-CAN-002 | P0 | 生成中第一次Ctrl+C | 取消当前Turn，不退出进程 |
| CLI-CAN-003 | P0 | 取消已收敛后再次Ctrl+C | 作为新的空闲输入处理 |
| CLI-CAN-004 | P0 | 未收敛时第二次Ctrl+C | 调用可注入forceExit |
| CLI-CAN-005 | P0 | Approval中Ctrl+C | 走当前Turn取消 |
| CLI-CAN-006 | P0 | loading | 取消后timer和终端控制序列清理 |
| CLI-CAN-007 | P0 | 下一轮 | Ctrl+C计数重置 |
| CLI-CAN-008 | P1 | Windows/macOS/Linux按键表示 | 纯解析测试覆盖已支持序列 |

## 9. Quiescence与隐私

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| QUIET-001 | P0 | cancelled事件后 | 无后续Tool lifecycle事件 |
| QUIET-002 | P0 | whenIdle后 | 无后续文件写入或Session保存 |
| QUIET-003 | P0 | Provider忽略signal | Runtime等待其结算，不提前宣称quiescent |
| QUIET-004 | P0 | 终态保存失败 | 返回安全持久化错误，不伪造cancelled完成 |
| PRIV-001 | P0 | 所有取消路径 | stdout/stderr不含Key、prompt、Tool参数/结果 |
| PRIV-002 | P0 | Journal | 只保存稳定原因，不保存AbortSignal.reason任意正文 |

## 10. 全链路验收

使用临时Profile、workspace、Session/Memory和本地受控HTTP Provider：

1. 启动NDJSON并确认cancellation capability；
2. Provider等待时发送cancel，确认ack与response_cancelled；
3. 检查Session中user保留、assistant缺失、Journal cancelled/aborted；
4. 新Turn正常完成，证明无取消污染；
5. 写Tool进入Approval后取消，确认文件不存在；
6. 受控Tool运行中取消，确认没有后续模型请求；
7. 重启恢复并确认不重放；
8. 活动请求期间exit，确认先quiescence再bye；
9. 扫描协议、诊断和持久化文件；
10. 删除全部临时资源。

人工测试只保留真实终端双Ctrl+C视觉和手感检查，核心语义必须由自动测试覆盖。

## 11. 最终门禁

```text
npm run typecheck
npm test
npm run build
npm run pack:check
git diff --check
```

收口报告必须记录通过/跳过/失败数、所有P0状态、三种Provider signal验证、quiescence验证、秘密扫描、真实Provider是否运行、Git状态和已知限制。

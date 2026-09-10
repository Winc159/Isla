# Isla v0.1.9 NDJSON 测试协议

## 目标

v0.1.9 为 Isla 增加一个仅通过本地标准输入/输出工作的机器可读测试入口，使外部测试进程或开发可以连续向真实 Runtime 发送消息、处理审批并收集 Tool 与最终回答事件。

该入口用于验证真实 Provider 下的意图分类、上下文、Agent Loop、Tool、Approval、Sandbox 和多轮对话，不替代现有交互式 CLI，也不开放网络服务。

## 设计原则

- NDJSON 入口与交互式 CLI 共用 `IslaRuntime`、`ChatSession` 和 `SessionStore`；
- 每行是一个完整 JSON 对象，以换行分隔；
- stdout 只输出协议事件，日志与诊断只写 stderr；
- 请求按输入顺序串行处理，v0.1.9 不支持并发 prompt；
- 未识别消息、无效 JSON 和缺失字段返回协议错误，不使进程崩溃；
- 默认不监听端口，不接受远程连接；
- NDJSON 模式不使用 raw TTY 输入编辑器；
- Approval 仍由 Runtime 请求，协议端只负责把请求转交给控制方；
- 测试入口不能绕过 PermissionPreset、ApprovalPolicy 或 SandboxPolicy。

## 启动方式

```text
npm run dev -- --protocol ndjson
npm run start -- --protocol ndjson
```

没有 `--protocol ndjson` 时保持现有 CLI 行为。未知 protocol 应在启动阶段报错并返回非零退出码。

## 输入消息

```ts
type ProtocolRequest =
  | { readonly type: "prompt"; readonly id: string; readonly text: string }
  | { readonly type: "approval_response"; readonly id: string; readonly approved: boolean; readonly remember?: boolean }
  | { readonly type: "new_session"; readonly id: string }
  | { readonly type: "exit"; readonly id: string };
```

约束：

- `id` 由调用方提供，在对应输出中原样返回；
- 同一进程内请求 id 必须唯一；
- `prompt.text` 必须是非空字符串；
- 一个 prompt 尚未结束时，只接受对应审批响应或 exit；
- `remember: true` 等价于交互式 CLI 的 `a`，只在当前进程内记住同一 Tool 与权限组合；
- `new_session` 创建新会话并清除待确认执行状态；
- `exit` 完成当前可安全结束的写入后退出，不启动新模型请求。

## 输出事件

```ts
type ProtocolEvent =
  | { readonly type: "ready"; readonly provider: string; readonly model: string }
  | { readonly type: "response_start"; readonly id: string }
  | { readonly type: "response_delta"; readonly id: string; readonly text: string }
  | { readonly type: "tool_start"; readonly id: string; readonly tool: string }
  | { readonly type: "tool_end"; readonly id: string; readonly tool: string; readonly ok: boolean }
  | { readonly type: "approval_request"; readonly id: string; readonly approvalId: string; readonly tool: string; readonly permission: string; readonly summary: string }
  | { readonly type: "response_end"; readonly id: string; readonly text: string; readonly elapsedMs: number }
  | { readonly type: "error"; readonly id?: string; readonly code: string; readonly message: string; readonly recoverable: boolean }
  | { readonly type: "session_changed"; readonly id: string; readonly sessionId: string }
  | { readonly type: "bye"; readonly id: string };
```

`response_end.text` 是最终完整回答；delta 只用于实时观察。Tool 结果正文默认不输出，避免泄漏文件内容；测试若需要断言 Tool 结果，应通过受控 debug 事件或 FakeProvider 测试完成，不在生产协议默认暴露。

## Approval 协议

NDJSON 模式使用独立 `ProtocolApprovalService`：

```text
ToolRuntime 请求审批
→ 输出 approval_request
→ 暂停当前 prompt
→ 等待相同 approvalId 的 approval_response
→ 继续或拒绝 Tool
```

要求：

- approvalId 与 prompt id 分离；
- 非当前审批的响应返回 `UNEXPECTED_APPROVAL`；
- exit、stdin EOF 或控制方断开时，所有等待审批默认拒绝；
- 协议模式不得读取单个 raw 字符；
- `remember` 只存在于当前进程内，不写入配置或会话历史。

## 生命周期与错误

- Runtime 和会话准备完成后输出一次 `ready`；
- 每个 prompt 最多一个 `response_start` 和一个终态 `response_end` 或 `error`；
- 解析错误使用 `INVALID_JSON`；
- schema 错误使用 `INVALID_REQUEST`；
- 重复 id 使用 `DUPLICATE_ID`；
- prompt 进行中又收到 prompt 使用 `BUSY`；
- Provider、Tool Loop 和持久化错误转换为稳定 code，详细堆栈只在 stderr debug 日志中；
- stdin EOF 等价于拒绝待处理审批并有界退出；
- stdout 写入失败终止进程，避免控制方误以为任务仍在运行。

## 安全边界

- 不提供 HTTP/WebSocket/TCP 监听；
- 不增加 danger-full-access；
- 不允许输入消息直接指定项目根目录、Provider、模型或权限预设；
- 启动配置仍来自现有配置加载边界；
- Tool 参数与文件内容不得进入默认日志；
- 测试 Fixture 禁止包含真实 API Key、会话内容或私人路径；
- 真实 Provider 测试必须显式运行，不进入默认离线测试。

## 测试分层

1. 协议 parser 单元测试：合法请求、无效 JSON、schema、重复 id。
2. Approval 单元测试：批准、拒绝、remember、EOF、错误 approvalId。
3. 内存流集成测试：prompt、stream delta、Tool 事件、错误和退出。
4. 子进程端到端测试：启动 `dist`、等待 ready、连续对话、正常退出。
5. FakeProvider Agent 场景：自省、讨论转执行、失败恢复和历史引用。
6. 真实 Provider smoke：显式开启，只验证一次短对话与一次只读检查。

## 是否沉淀为 Skill

v0.1.9 不把协议实现成 Skill。Skill 不能替代 Runtime 入口、协议状态机或自动测试。

协议稳定并至少完成两轮真实回归后，可以新增 `isla-runtime-testing` Skill，封装：

- 启动 NDJSON 模式；
- 等待 ready；
- 发送多轮测试脚本；
- 自动处理预设审批；
- 汇总 transcript、Tool 事件和错误；
- 输出行为评估报告。

Skill 不持有密钥、不绕过审批，也不把测试 transcript 提交到 Git。

## 暂缓

- 网络 API、WebSocket 和远程控制；
- 多客户端、并发 prompt 和请求取消；
- 通用 JSON-RPC；
- 跨语言 SDK；
- 录制真实 Tool 结果正文；
- 自动评分模型与自动修改源码。

## 完成信号

- 交互式 CLI 行为无回归；
- NDJSON stdout 可被逐行 JSON 解析且没有普通文本；
- 连续多轮 prompt、Tool、审批、错误、new_session 和 exit 均有自动测试；
- 子进程测试可以稳定启动、对话和退出；
- `npm run typecheck`、`npm test`、`npm run build` 和 `npm run pack:check` 全部通过；
- 默认测试不需要网络或真实密钥。


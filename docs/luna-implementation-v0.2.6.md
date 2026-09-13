# Luna：Isla v0.2.6 端到端取消实施清单

## 1. 唯一基线

实施前完整阅读 `AGENTS.md`、`docs/architecture-v0.2.6.md`、`docs/testing-v0.2.6.md`、v0.2.5.1 架构与收口，以及当前 Session、Provider、Tool、Approval、CLI、Protocol 和 Journal 实现。

任何联网、Shell、流式输出、后台任务、队列、子 Agent 或通用生命周期框架都超出本版范围，必须停止并重新确认。

## 2. 全程规则

- 每次只完成一个可独立验证 Batch；
- 先写能在旧实现上失败的测试，再改代码；
- 每个 Batch 后运行专项测试和 typecheck并停点；
- 不读取真实配置、Memory、Session、日志或 Key；
- 不用睡眠作为主要竞态断言，使用受控 deferred/barrier；
- 不把 AbortError 名称或 SDK 私有错误文本直接作为公共协议；
- 不执行 Git add、commit、push、历史重写或 npm publish。

## 3. Batch A：锁定终态和 Journal 契约

1. 定义 `TurnCancelReason`、`TURN_CANCELLED` 与统一取消识别函数；
2. 扩展 Turn status 为 cancelled、Attempt status 为 aborted；
3. 更新 Journal validator；
4. 明确 cancelled 没有 assistantMessageIndex；
5. 保持 running 崩溃恢复为 interrupted；
6. 增加旧 v1/v2/v3 兼容测试；
7. 暂不连接 Provider 或入口。

停点：Journal、SessionStore、errors 专项测试和 typecheck通过。

## 4. Batch B：Provider signal

1. 为 Provider generate/generateWithTools 增加执行 options；
2. FakeProvider 记录 signal，支持受控等待和取消；
3. OpenAI、DeepSeek、Local 向底层 SDK 传 signal；
4. signal 已取消时不发请求；
5. 取消不进入 modelRetries；
6. SDK AbortError规范化为 TURN_CANCELLED；
7. timeout、network、auth现有分类不变。

停点：三种 Provider适配器单测、retry和typecheck通过。

Batch B 实施记录（接口边界）：已增加 `ModelCallOptions.signal`，OpenAI、DeepSeek、Local 适配器均将 signal 传递给底层 SDK；AbortError 统一为不可重试的 `TURN_CANCELLED`。由于每 Turn 的 controller 仍由 Batch D 的 ChatSession 创建，本批保留 options 可选兼容形态，尚未宣称端到端取消完成。Provider、错误规范化、retry 和 Session 回归共 30 条通过。

## 5. Batch C：Tool 与 Approval signal

1. 扩展 Tool.execute 与 ToolRuntime.execute；
2. 扩展 ApprovalService.request；
3. CLI Approval取消时清理 raw mode和监听器；
4. Protocol Approval取消时清除 pending；
5. Permission判定后、实际副作用前再次检查 signal；
6. 内置文件 Tool在关键I/O边界检查 signal；
7. 取消不映射为 USER_REJECTED或 EXECUTION_FAILED。

停点：ToolRuntime、CLI Approval、Protocol Approval、文件 Tool专项测试通过。

Batch C 实施记录：Tool 与 Approval 已支持可选 AbortSignal；ToolRuntime 在执行前、describe 后、Approval 后和 Tool 返回后 fail closed，取消统一返回 `TURN_CANCELLED`；CLI/Protocol Approval 会清理等待并返回取消决定；内置文件与搜索 Tool 在关键边界检查 signal。Tool、Approval、Sandbox 和 Session 回归共 36 条通过。ChatSession 尚未创建或传播 controller，端到端取消仍留待 Batch D。

## 6. Batch D：ChatSession活动控制

1. 每次 send 创建新的 controller；
2. 暴露 cancelActiveTurn/whenIdle 或等价窄接口；
3. send并发调用 fail closed；
4. 在 Memory、Provider、Approval、Tool和step边界检查 signal；
5. 使用单一settlement gate仲裁成功、失败和取消；
6. 取消保留user，不提交assistant；
7. 记录cancelled Turn和aborted Attempt；
8. 不调用onTurnCommitted；
9. 等待终态持久化后进入idle；
10. finally使用controller identity guard。

停点：Session取消、竞态、持久化失败和下一Turn隔离测试通过。

## 7. Batch E：NDJSON取消

1. parser接受cancel请求和targetId；
2. runner校验当前activeId；
3. 发出cancel_ack；
4. quiescence后发response_cancelled；
5. 与response_end/error做唯一终态仲裁；
6. EOF触发disconnect取消；
7. exit等待当前活动请求结算后bye；显式cancel负责取消当前Turn；
8. 清理pending approval；
9. ready capability暂不提前改true，完成本Batch专项测试后再开启。

停点：parser、protocol、approval、stdout纯NDJSON和子进程专项测试通过。

Batch E 实施记录：NDJSON 已支持 `cancel` 请求、target 校验、`cancel_ack` 与 quiescence 后的 `response_cancelled`；EOF 会以 disconnect 原因取消活动 Turn，显式 exit 保持原有等待结算语义；取消终态与 `response_end/error` 互斥。协议、Approval、子进程和 Session 回归共 39 条通过，`ready.capabilities.cancellation` 已开启。

## 8. Batch F：CLI Ctrl+C

1. 输入编辑器明确空闲Ctrl+C行为；
2. 生成期间安装临时SIGINT/keypress处理；
3. 第一次取消当前Turn并只提示一次；
4. 第二次仅在当前取消未收敛时强制退出；
5. 成功、失败、取消都清理handler和loading；
6. 新Turn重置计数；
7. Approval期间Ctrl+C走同一Turn取消；
8. 更新/help说明。

测试不得真的退出Vitest进程；进程退出函数和信号源必须可注入。

停点：CLI普通输入、生成、Approval、双Ctrl+C专项测试通过。

Batch F 实施记录：CLI 生成期间增加可注入的 SIGINT 控制器；第一次 Ctrl+C 调用当前 Session 取消并提示，第二次在未收敛期间调用 forceExit(130)，成功/失败/取消后均移除 handler 并等待 `whenIdle()`；帮助文本已同步。CLI 取消专项与既有回归通过后，Batch G 再补真实双 Ctrl+C 子进程链路。

Batch G 实施记录：补充真实 NDJSON 子进程取消测试，使用受控本地 HTTP Provider 验证请求已发出后取消、`cancel_ack`、唯一 `response_cancelled`、无秘密输出及退出收敛。完整门禁通过：225 passed、4 skipped；typecheck、build、pack:check、git diff --check 均通过。

## 9. Batch G：全链路与收口

1. 用临时Profile、workspace、Session/Memory和本地受控HTTP Provider启动NDJSON；
2. 在Provider等待时取消并验证user保留；
3. 在Approval等待时取消并验证没有写文件；
4. 在Tool执行等待时取消并验证没有后续模型步骤；
5. 重启验证cancelled/aborted Journal；
6. 发起新Turn证明旧signal无污染；
7. exit并验证bye发生在quiescence后；
8. 扫描stdout/stderr和持久化文件中的秘密哨兵；
9. 将ready cancellation改为true；
10. 更新Roadmap、README、参考记录和最终测试数量。

最终门禁：

```text
npm run typecheck
npm test
npm run build
npm run pack:check
git diff --check
```

## 10. 停止条件

出现以下任一情况必须停止并请求设计确认：

- 需要Session v4而不是兼容扩展；
- 某Provider SDK无法接受AbortSignal；
- 文件Tool无法在不改变写入原子性的情况下协作取消；
- CLI跨平台双Ctrl+C无法通过可注入测试稳定表达；
- quiescence要求引入后台任务管理器或通用事件总线；
- 需要破坏NDJSON旧事件语义。

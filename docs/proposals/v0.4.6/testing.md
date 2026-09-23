# v0.4.6 测试设计

## 1. 自动化测试矩阵

### 元数据与配置

- `LIMIT-01`：百炼目录正确投影 context、input、output 和可选 reasoning 限制。
- `LIMIT-02`：`null`、缺失、负数、小数和矛盾目录字段不会形成伪限制。
- `LIMIT-03`：旧目录 cache 无新字段仍可读取，新 cache 不含 API Key、Workspace ID 或请求头。
- `LIMIT-04`：旧 Profile 保持兼容；三个新字段只接受正整数。
- `LIMIT-05`：Profile 工作预算、模型输入上限、总窗口减输出预留按最严格值解析。
- `LIMIT-06`：普通启动不请求模型目录；live、cache、stale、profile、fallback 来源可区分。

### 估算与投影

- `LIMIT-07`：中英文、代码、JSON 和 Unicode 输入的估算确定且单调。
- `LIMIT-08`：角色、Tool schema、Tool arguments、Tool result、Memory、Task State 和 checkpoint 均计入预算。
- `LIMIT-09`：轮次、字符和 Token 三种预算共同生效，任何一个达到阈值都触发压缩判断。
- `LIMIT-10`：压缩只处理完整旧 Conversation Unit，不拆开 tool call/result。
- `LIMIT-11`：压缩后的请求不超过有效估算预算，完整 Session messages 未被删除或改写。
- `LIMIT-12`：当前单轮无法容纳时返回 `CONTEXT_INPUT_TOO_LARGE`，Provider 调用次数为零，用户输入仍按既有事实语义保存。
- `LIMIT-13`：checkpoint 生成失败后的原始投影若超限，不会绕过门禁调用 Provider。

### Provider 与错误

- `LIMIT-14`：百炼/OpenAI-compatible 请求使用 `max_completion_tokens`，值不超过模型与 Profile 上限。
- `LIMIT-15`：不支持输出限制的 Adapter 不发送未知字段，并报告 unsupported。
- `LIMIT-16`：Provider context-length 错误归一化到 limit domain，相同请求不重试。
- `LIMIT-17`：取消、流式和 one-shot 路径使用同一预算快照，输出上限一致。

### Surface 与隐私

- `LIMIT-18`：`/models info` 对已知、未知和缓存模型输出稳定，不显示秘密。
- `LIMIT-19`：`/context`、NDJSON 和 Resident Host 对同一 Session 报告相同预算与来源。
- `LIMIT-20`：诊断和 Journal 只含数值、来源与原因，不含消息正文、Tool 参数或凭据。
- `LIMIT-21`：切换模型只影响下次启动；活动 Session 的预算快照不漂移。

## 2. 回归门禁

- v0.4.3 checkpoint、完整历史和 `/context` 现有测试继续通过。
- 模型目录 list/search/browse/use、十行预览和 cache fallback 继续通过。
- Tool、Skill、MCP 请求中的 schema 仍由同一 Capability Snapshot 决定。
- CLI、NDJSON、Resident Host 不复制预算算法。
- `typecheck`、单元/集成测试、build、tarball smoke 和 diff check 全绿。

## 3. 百炼真实评估

固定 Profile 使用 `deepseek-r1-distill-qwen-7b`，保留完整、脱敏的输入输出和时间记录：

1. `CATALOG`：刷新目录并用 `/models info` 核对模型上限与来源。
2. `BASELINE`：短会话确认没有不必要压缩，记录首字和总耗时。
3. `LONG-SESSION`：逐轮增加上下文直至提前压缩，确认不等待 Provider 400 才处理。
4. `OVERSIZED-TURN`：构造超过工作预算的单轮输入，确认本地拒绝且 Provider 未调用。
5. `OUTPUT-CAP`：要求冗长推理/回答，确认请求携带输出上限并观察终止原因。
6. `NO-CATALOG`：移走测试 cache 并禁用网络，确认字符/轮次 fallback 可解释且可用。

真实评估不以“模型回答更聪明”为通过条件；本版评估的是预算、延迟收敛和错误可解释性。

## 4. macOS 本地补证

在真实设备可用时记录：芯片、统一内存、模型文件、量化、模型服务、配置窗口和实际工作预算。执行与百炼相同的 BASELINE、LONG-SESSION、OVERSIZED-TURN、OUTPUT-CAP，比较：

- prompt processing tokens/s；
- generation tokens/s；
- 首字与总耗时；
- 峰值内存；
- 8K/16K 工作窗口下是否出现明显质量或速度退化。

没有真实 macOS 设备时只允许声明“待补证”，不能以 Windows 或云端结果替代。

## 5. 验收阻断项

以下任一项出现即不通过：

- 已知会超出有效预算仍调用 Provider；
- 静默截断当前用户输入；
- 压缩或预算计算改写完整 Session 事实；
- 普通启动被模型目录网络请求阻塞；
- stale/未知限制被展示为精确官方上限；
- 输出上限字段映射错误或相同 limit 请求自动重试；
- 任一 Surface 的预算结果不一致；
- 诊断、cache 或 Journal 泄露凭据或私人正文。

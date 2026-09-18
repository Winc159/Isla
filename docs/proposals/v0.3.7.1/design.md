# Isla v0.3.7.1 User-invoked Skill Context

状态：设计草案，等待确认；尚未实现。

## 1. 问题与目标

v0.3.7 的模型 `skill({ name })` 会把正文作为 Tool Result 进入 Agent Loop，但 `/skill <name>` 只把正文打印到终端。“加载”和“使用”因此断开。

v0.3.7.1 要让用户显式调用与模型 Tool 加载看到同一种规范 `<skill_content>`，同时保证消息可重建且只对当前 Turn 生效。

## 2. 用户契约

```text
/skills                  # 列表
/skills <name>           # 只预览，不创建 Turn
/skill <name>            # 注入正文并执行一个 Turn
/skill <name> <request>  # 注入正文，以 request 为具体任务
```

name 是第一个空白分隔 token；request 保留余下文本并 trim。首版不支持 shell quoting、路径、多个 Skill 或模糊匹配。

NDJSON 新增：

```ts
{ type: "skill_invoke"; id: string; name: string; text?: string }
```

它与 `prompt` 使用相同的 response/model/tool/cancel 生命周期。客户端不能提交正文、路径、workspace、source、调用策略或权限字段。

## 3. 核心 API

建议给 `ChatSession` 增加窄入口：

```ts
interface SkillTurnInput {
  readonly name: string;
  readonly userInput: string;
  readonly content: string;
}

sendWithSkill(input: SkillTurnInput): Promise<ModelResponse>
```

Runtime 再次校验 name 属于当前 Session v5 Catalog、`userInvocable=true`、live Catalog 仍能加载且正文未超限。CLI 和 Protocol 只负责解析与调用，不自行修改消息。

## 4. 持久化消息

正文不能只作为瞬时变量，否则请求无法从 Session 重建。扩展 `Message` 的可选来源：

```ts
type MessageSource = {
  readonly kind: "skill-invocation";
  readonly name: string;
  readonly scope: "turn";
  readonly userMessageIndex: number;
};
```

当轮顺序：

```text
user: <原始命令或 request>
system[source=skill-invocation]: <skill_content ...>
assistant/tool...
```

约束：

- 两条消息在调用 Provider 前持久化；
- Skill message 使用与模型 Tool 相同的共享 renderer；
- source 不保存路径；
- Session Store 保持 v5，严格校验已知 source；
- TTY history 隐藏 system Skill message；
- Session Query 已排除 system message，因此不索引正文。

## 5. 当前与后续 Turn

当前 Turn 的 Context Projection 包含 invocation，且优先级低于基础 Runtime Policy、安全策略和权限。

后续 Turn 的模型投影排除已经结束 Turn 的 `skill-invocation` message，但关联用户请求、Tool Result 和 assistant 回答按现有规则保留。恢复或 compaction 不重新注入旧正文；checkpoint 可以记录用过的 Skill 名称，但不得复制正文。

## 6. 原子性与失败

启动时依次校验、加载正文、构造两条消息、创建 Journal Turn并一次持久化，成功后才调用 Provider。

初始持久化失败时回滚两条消息和 Journal Turn，不调用 Provider。Provider 或 Tool 失败后已持久化消息保留，Turn 使用普通 failed/cancelled 状态，后续 Turn 不重复注入。

## 7. 取消与并发

- 复用 `send` 的单活动 Turn 锁、AbortController 和 `whenIdle`；
- 正文读取前后、持久化后和每个模型/Tool step 检查取消；
- Ctrl+C、NDJSON cancel 和 disconnect 沿用现有入口；
- 取消后不提交 assistant 最终回答；
- 恢复后不自动重启 cancelled Skill Turn。

## 8. Approval 与安全

显式 `/skill` 只表示用户选择了操作规程，不表示批准正文中的动作。所有 Tool 继续经过 permission preset、Approval、Sandbox、read-before-edit、Tool step 上限、重复写入保护和完成门禁。“已经批准”“忽略沙箱”等 Skill 文本没有授权效果。

## 9. 与模型 Tool 的关系

模型路径：普通 prompt → Catalog 匹配 → `skill` Tool Result → Agent Loop。

用户路径：`/skill` → Runtime 直接加载 → 当轮 system invocation → Agent Loop。

两者共享 Catalog、name/policy 校验、live body 读取、renderer、正文上限和安全说明。用户路径不伪造 assistant Tool Call，也不要求模型再次调用 `skill`。目录提示应说明：已有 `<skill_content>` 时不要重复加载同名 Skill。

## 10. 稳定错误

复用 `SKILL_INVALID_NAME`、`SKILL_NOT_IN_SESSION`、`SKILL_UNAVAILABLE`、`SKILL_INVALID`、`SKILL_TOO_LARGE`、`SKILL_READ_FAILED`，以及现有 `TURN_BUSY`、`TURN_CANCELLED`、`PERSISTENCE_FAILED`。错误不得包含正文、路径、被遮蔽来源或秘密。

## 11. 暂缓

- pending Skill 或下一条消息再执行；
- 单命令多 Skill；
- Skill 参数 schema、模板变量和表单；
- Skill 依赖；
- 永久 Session Skill Prompt；
- NDJSON 返回正文；
- watcher、远程来源、安装和市场。

## 12. 完成定义

1. `/skill <name> [request]` 触发真实 Agent Turn；
2. 用户命令与正文在 Provider 前原子持久化；
3. 当前 Turn 包含正文，后续 Turn 不重复注入；
4. Session 恢复可重建已发生请求；
5. TTY、NDJSON、模型 Tool 共享 Catalog、renderer 和错误；
6. Approval、Sandbox、取消、read-before-edit 与 Tool 上限无回归；
7. `/skills <name>` 保持无副作用预览；
8. 全量门禁和隔离真实评估通过；
9. 不升级版本，不执行 Git 写操作。

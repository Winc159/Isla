# Isla v0.3.7.1 实施顺序

状态：已完成；Batch A-D 已实施。Bailian NDJSON 真实评估通过；TTY 管道不计为 TTY 评估，后续若需要应使用真实 PTY 单独验证。

## 0. 开始前

读取项目规则、v0.3.7 与本提案；检查工作区；运行 Skill、Session、CLI、Protocol、取消和 Approval 基线。保持 package `0.2.9`，不执行 Git 写操作，不提前访问真实 Provider。

## 1. Batch A：共享 renderer 与消息来源

建议新增 `src/skills/render.ts`、`src/skills/invocation.ts` 和对应测试；修改 `src/core/types.ts`、`src/session-store.ts`、`src/tools/skill.ts`。

步骤：

1. 提取共用 `<skill_content>` renderer；
2. 定义严格的 `skill-invocation` source；
3. 扩展 Session message 校验；
4. 实现 invocation 构造函数；
5. 固定安全说明；
6. 确认 Session Query、TTY history 和 diagnostics 不展示正文。

停点：renderer/source/Session round-trip 通过，CLI 尚不触发模型。

## 2. Batch B：ChatSession 当轮调用

修改 `src/core/session.ts`、`context.ts`、`request-context.ts`、`runtime.ts` 及测试。

步骤：

1. 增加 `sendWithSkill`；
2. 复用单活动 Turn与取消；
3. Provider 前一次写入用户消息、Skill message 和 Journal Turn；
4. 保存失败时原子回滚；
5. 当前 Turn 包含 invocation；
6. 后续 Turn 过滤旧 invocation；
7. compaction 不复制正文；
8. 复用 Provider/Tool/完成门禁错误语义；
9. 防止模型重复加载同名 Skill。

停点：FakeProvider 完成 direct invocation → Tool → response，普通 send 无回归。

## 3. Batch C：TTY 与 NDJSON

修改 CLI command/result/handler 和 Protocol type/parser/runner。

步骤：

1. `/skills <name>` 保持预览；
2. `/skill <name> [request]` 返回 invoke command result；
3. CLI handler 调用 `sendWithSkill`，复用加载、取消和耗时显示；
4. 增加 NDJSON `skill_invoke`；
5. 复用 prompt 事件生命周期；
6. active Turn 返回 BUSY；
7. 协议不返回正文或路径；
8. 切换 Session 和 `/new` 后重新校验。

停点：TTY 与 NDJSON 都能显式调用，且没有第二套 Agent Loop。

## 4. Batch D：门禁与真实评估

执行 typecheck、全量测试、build、pack check、audit、diff check 和 status；另覆盖 v1-v5 Session、source 损坏、敏感内容扫描、TTY/NDJSON subprocess、取消、Approval、Sandbox 和 read-before-edit。

真实评估需再次授权并使用隔离 Config、workspace、Skill、Session 和 memory。只记录 Tool 名、错误码、Session 版本、Turn 状态和清理结果。

## 5. 接手原则

从 Batch A 开始，不直接在 CLI 拼 system message；保持模型 Tool 路径；不用 pending Skill 绕过当轮持久化；不升级版本、不执行 Git 写操作、不提前访问真实 Provider。

# Isla v0.3.7 测试计划

状态：Batch A/B/C/D1/D2/E 已执行，Skill 针对性测试 7/7、Session v5 专项测试 2/2、Protocol/CLI 回归通过；全量 388 passed、7 skipped。默认全部离线，fixture 只能使用虚构 Skill、临时目录和无秘密内容。

## 1. Skill 格式

### SKILL-FORMAT-001 最小有效 bundle

包含 name、description 和非空正文的 `SKILL.md` 可解析，两个调用策略默认 `true`。

### SKILL-FORMAT-002 名称语法

只接受小写 kebab-case；拒绝大写、空格、斜杠、点段、Unicode 混淆和超长名称。

### SKILL-FORMAT-003 目录名一致

frontmatter name 与 bundle 目录名不一致时跳过，不以正文声明重定向到其他名称。

### SKILL-FORMAT-004 必填字段

缺少 name、description、结束分隔符或正文时返回稳定错误。

### SKILL-FORMAT-005 严格布尔值

只接受 `true` 和 `false`；字符串别名、数字、数组和对象均拒绝。

### SKILL-FORMAT-006 受限 frontmatter

嵌套对象、数组、锚点、多行 YAML、模板和环境变量不被解释。

### SKILL-FORMAT-007 未知字段

未知字段产生有界 warning，但不进入模型目录和 Tool Result。

### SKILL-FORMAT-008 上限

名称、描述、正文、文件字节数和目录总量分别达到边界时可预测；超限安全失败。

### SKILL-FORMAT-009 UTF-8 与换行

UTF-8 中文正文和 CRLF/LF 均可解析；无效编码不产生部分正文。

## 2. 文件系统发现

### SKILL-DISCOVERY-001 固定根

只扫描 workspace `.isla/skills` 与 personal `.isla/skills`。

### SKILL-DISCOVERY-002 缺失根

根目录不存在时返回空目录，不创建文件夹、不报致命错误。

### SKILL-DISCOVERY-003 深度

只发现 `<root>/<name>/SKILL.md`；忽略平铺 Markdown、嵌套 bundle 和其他文件名。

### SKILL-DISCOVERY-004 覆盖

workspace 同名有效 Skill 覆盖 personal Skill，结果与文件系统枚举顺序无关。

### SKILL-DISCOVERY-005 同根冲突

Windows 大小写碰撞或其他同根重名使该名称不可用，并产生稳定 warning。

### SKILL-DISCOVERY-006 确定排序

相同目录重复发现得到按名称排序的相同结果。

### SKILL-DISCOVERY-007 损坏隔离

一个 Skill 无效不阻止其他合法 Skill；根目录整体不可读时返回有界诊断。

### SKILL-DISCOVERY-008 符号链接逃逸

指向根目录或 bundle 外的 symlink/junction 被拒绝；平台不支持创建时测试显式 skip。

### SKILL-DISCOVERY-009 取消

扫描或加载前后取消均停止工作，不返回部分正文。

### SKILL-DISCOVERY-010 正文实时读取

目录摘要固定后修改正文，下一次 load 读取新正文；修改 name 或调用策略导致原快照名称不可用。

## 3. Config

### SKILL-CONFIG-001 默认开启

Profile 未声明 skills 时使用默认开启语义。

### SKILL-CONFIG-002 显式关闭

`skills.enabled=false` 时不扫描目录、不保存条目、不注册模型 Tool 和 CLI 加载能力。

### SKILL-CONFIG-003 严格类型

非布尔 enabled 被拒绝；未知字段遵循现有 Config warning 规则。

### SKILL-CONFIG-004 Config 事实源

`.env` 中伪造 Skills 字段不影响正常 Profile 启动。

## 4. Session v5

### SKILL-SESSION-001 新 Session

新 Session 保存版本化、排序、有界的胜出目录快照及调用策略。

### SKILL-SESSION-002 空快照

没有 Skill 时也保存明确空快照，恢复后不因新增文件自动改变。

### SKILL-SESSION-003 旧版本读取

v1-v4 Session 继续可读取，消息、TaskState、Journal、Context 和 workspaceKey 不变。

### SKILL-SESSION-004 首次迁移

旧 Session 首次保存迁移到 v5，并只在该时点固定一次目录。

### SKILL-SESSION-005 v5 恢复

文件目录变化后恢复 v5，模型仍收到原目录摘要；不静默发布新名称。

### SKILL-SESSION-006 `/new` 刷新

新增、删除或修改摘要后执行 `/new`，新 Session 得到新目录。

### SKILL-SESSION-007 最小持久化

Session 快照不包含正文、绝对路径、source、rank 或资源列表；模型目录必须过滤掉 `modelInvocable=false` 条目。

### SKILL-SESSION-008 CAS

Session 并发保存和 revision/CAS 行为无回归。

### SKILL-SESSION-009 损坏快照

非法名称、重复项、超限描述和未知版本被拒绝，不把未经验证内容注入模型。

## 5. 模型目录

### SKILL-PROMPT-001 有界摘要

只渲染 Session 快照的 name 和 description，不包含正文、路径、source 或调用策略。

### SKILL-PROMPT-002 摘要不是指令

固定说明要求模型先加载正文，不允许从 description 推断操作步骤。

### SKILL-PROMPT-003 空目录

空快照不增加目录消息或无意义 token。

### SKILL-PROMPT-004 可重建

创建、持久化、退出、恢复后构造出的目录内容字节一致。

### SKILL-PROMPT-005 Compaction

历史压缩后目录仍由结构化快照重新构造；不复制完整 Skill 正文。

### SKILL-PROMPT-006 字符转义

描述中的伪 XML、Markdown 和提示注入文本只能作为转义后的摘要数据出现。

## 6. `skill` Tool

### SKILL-TOOL-001 Schema

模型参数只有必填 `name`，拒绝未知字段、路径、workspace、source 和 limit。

### SKILL-TOOL-002 成功加载

快照中存在且当前仍允许模型调用的名称返回规范 `<skill_content>`。

### SKILL-TOOL-003 不在 Session

当前磁盘存在但未进入 Session 快照的名称返回 `SKILL_NOT_IN_SESSION`。

### SKILL-TOOL-004 已删除或禁用

快照有名称但当前定义缺失或不再允许模型调用时返回 `SKILL_UNAVAILABLE`。

### SKILL-TOOL-005 路径隐私

成功和失败结果均不返回绝对路径、home 路径或被遮蔽来源。

### SKILL-TOOL-006 正文上限

超限正文不部分返回，使用稳定错误码。

### SKILL-TOOL-007 同 Turn 幂等

相同 Skill 内容重复加载不重复注入全文；不同 Skill 或正文变化不误判重复。

### SKILL-TOOL-008 取消

取消发生后不追加成功 Tool Result、不继续模型步骤。

### SKILL-TOOL-009 Tool 历史

成功正文作为正常 Tool Result 持久化，恢复请求可以重建。

### SKILL-TOOL-010 错误归一化

解析、I/O、取消和超限错误经过现有 Tool Runtime 返回稳定、无敏感信息的结果。

## 7. Agent Loop

### SKILL-LOOP-001 匹配后加载

FakeProvider 先收到摘要目录，再调用 `skill`，然后调用现有只读 Tool 并给出最终回答。

### SKILL-LOOP-002 不匹配不加载

普通问答不机械调用 `skill`。

### SKILL-LOOP-003 多 Skill

一个请求明确匹配两个 Skill 时可顺序加载，仍受现有 Tool Step 上限约束。

### SKILL-LOOP-004 Approval 不变

Skill 声称“无需确认”时，写入和命令工具仍执行原 Approval policy。

### SKILL-LOOP-005 Sandbox 不变

Skill 指示读取 workspace 外路径时仍被 Sandbox 拒绝。

### SKILL-LOOP-006 read-before-edit

Skill 指示直接编辑未读文件时仍被现有保护拒绝。

### SKILL-LOOP-007 TaskState 独立

加载 Skill 不创建或修改 TaskState；只有现有 `update_task_state` 能更新。

### SKILL-LOOP-008 历史搜索隔离

Session Query 不索引 Skill Tool Result 正文。

## 8. TTY CLI

### SKILL-CLI-001 `/skills`

显示当前 Session 用户可调用摘要并确定性排序。

### SKILL-CLI-002 空列表

无 Skill 时显示稳定短消息，不创建目录或 Session。

### SKILL-CLI-003 `/skill <name>`

精确加载一个用户可调用 Skill，并使用共享 renderer 进入当前请求。

### SKILL-CLI-004 调用策略

`user-invocable=false` 的 Skill 不显示且不能由 CLI 加载，即使模型可以加载。

### SKILL-CLI-005 解析

缺少名称、多余参数、非法名称和未知名称返回稳定错误，不作为普通聊天发送。

### SKILL-CLI-006 命令冲突

现有 `/sessions`、`/task`、`/new`、`/help` 等命令无回归；普通 `/path` 文本不会误触发 Skill。

## 9. NDJSON

### SKILL-PROTOCOL-001 list 配对

`skills_list` 的请求 ID 与响应配对，只返回有界摘要。

### SKILL-PROTOCOL-002 load 配对

`skill_load` 校验名称并产生稳定状态，不在协议响应中回显完整正文。

### SKILL-PROTOCOL-003 未知字段

路径、workspace、source、limit 和正文注入字段按现有协议规则拒绝或忽略，不影响授权边界。

### SKILL-PROTOCOL-004 恢复

协议重启恢复 v5 Session 后 list 内容一致，load 后下一模型请求可重建。

### SKILL-PROTOCOL-005 隐私

ready、skills 响应和 diagnostics 不包含正文、路径、密钥、Tool Result 或完整回答。

## 10. 跨平台与性能

### SKILL-PLATFORM-001 Windows

盘符、反斜杠、大小写和 junction 处理不导致重复或逃逸。

### SKILL-PLATFORM-002 macOS/Linux

POSIX 路径、大小写敏感和 symlink 语义通过纯函数或 CI 测试固定。

### SKILL-PERF-001 有界目录

超过最大 Skill 数量时确定性截断或失败，不能无限扩张请求上下文。

### SKILL-PERF-002 按需正文

未加载 Skill 时不读取全部正文进内存或模型请求。

### SKILL-PERF-003 无 watcher

运行时不持有文件 watcher、轮询器或后台定时器。

## 11. 回归门禁

必须通过：

```text
npm run typecheck
npm test
npm run build
npm run pack:check
npm audit
git diff --check
```

重点回归：

- Config/Profile 选择与秘密处理；
- Session v1-v5 读取、迁移、workspace 隔离和自动恢复；
- Context compaction 与 RequestContextBuilder；
- Tool schema、Tool Step 上限、取消和错误归一化；
- Sandbox、Approval、read-before-edit 和命令执行；
- TaskState、Session Query、Memory、TTY 与 NDJSON；
- OpenAI、DeepSeek、Bailian、Local Provider 离线兼容。

## 12. 测试数据规则

- 使用 `temporaryDirectory/release-check/SKILL.md` 等虚构目录；
- 正文只包含无害步骤，例如读取 fixture 并返回固定摘要；
- 不复制用户真实 Skill、私人路径、真实 Session、API Key、Token 或 `.env`；
- snapshot 和 assertion 不保存完整模型回答；
- 测试结束清理临时 home、workspace、Session、Config 和 memory 数据。

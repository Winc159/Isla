# Isla v0.3.7 Workspace and Personal Skills

状态：设计草案，等待确认；尚未实现。

## 1. 目标

v0.3.7 让 Isla 可以按需使用用户和项目维护的可复用操作规程，同时避免把所有规程永久写入基础 System Prompt。

本版建立以下闭环：

```text
发现摘要 → 固定 Session 目录 → 按需加载正文 → 使用现有 Tool 执行 → 正文和 Tool 轨迹可恢复
```

完成后，用户可以在个人目录维护通用习惯，在 workspace 目录维护项目规程；模型只在任务明确命中时加载正文。

## 2. DSH 参考结论

参考范围：

```text
packages/skill/skill
packages/skill/skill-filesystem
packages/skill/tool-skill
packages/api/session-controller/src/skill-catalog.ts
```

### 2.1 采用

- 目录摘要与正文分离：发现阶段只读取名称、描述和调用策略，正文按需加载；
- 模型先看到排序后的有界目录，再用精确名称调用 loader；
- 摘要只负责路由，明确要求模型不得仅凭摘要推断 Skill 指令；
- Skill 名称使用稳定的 kebab-case；
- 每次加载重新校验名称和可调用策略；
- 用户入口和模型入口可以有独立调用策略；
- Skill 正文作为正常模型上下文保存，恢复时不依赖模型“记住”先前加载内容；
- 资源基底只作为来源提示，不授予任何读取或执行权限；
- 模型只看到胜出的 Skill，不看到 rank、被遮蔽候选或本地绝对路径。

### 2.2 简化

- DSH 支持任意 Provider、分层 scope、rank 和动态注册；Isla 首版只有两个固定文件系统来源；
- DSH 支持目录 bundle 和平铺 Markdown；Isla 首版只支持目录 bundle；
- DSH 在目录变化后发布完整替换目录；Isla 首版在 Session 生命周期内固定目录，使用 `/new` 刷新；
- DSH 使用通用 YAML frontmatter；Isla 首版只解析一组受限标量字段，不引入 YAML 依赖；
- DSH 用 `/name` token 直接调用；Isla 使用无歧义的 `/skill <name>`，避免与现有 CLI 命令或路径混淆。

### 2.3 暂缓或拒绝

- 不引入 Cordis、DSH scope、Provider Registry 或 UI；
- 不加入 Chokidar、文件热刷新、缺失目录轮询或缓存失效协议；
- 不加入远程、包内嵌或运行时动态 Skill Provider；
- 不加入 rank 配置、任意覆盖链或被遮蔽候选查看 API；
- 不执行 Skill 内脚本，不自动安装依赖，不自动联网读取资源；
- 不让 Skill 增加 Tool、权限、Approval 例外或系统提示优先级；
- 不把 Skill 正文自动注入每一个请求；
- 不加入市场、同步、签名、版本解析或依赖图。

## 3. Skill 格式

首版只发现根目录直属的 bundle：

```text
<skill-root>/release-check/SKILL.md
```

文件必须以受限 frontmatter 开始：

```markdown
---
name: release-check
description: 检查 Isla 发布前的离线门禁与工作区状态
model-invocable: true
user-invocable: true
---

在执行发布动作前，先读取项目规则并运行离线门禁……
```

契约：

- `name`、`description` 必填；
- `model-invocable`、`user-invocable` 可选，默认 `true`；
- 名称必须匹配 `[a-z0-9]+(?:-[a-z0-9]+)*`，并与 bundle 目录名完全一致；
- frontmatter 只接受单行字符串和严格的 `true` / `false`；
- 未知字段报 warning 并忽略，已知字段类型错误则跳过整个 Skill；
- 正文必须是 UTF-8 文本且非空；
- 摘要规范化空白后有固定字符上限；正文、Skill 数量和目录总字符数都有 Runtime 固定上限；
- frontmatter 不支持嵌套对象、数组、锚点、多行 YAML 或环境变量展开。

首版常量的具体数值在 Batch A 通过 fixture 和上下文预算测试确定，随后作为代码常量固定，不开放给模型。

## 4. 来源与覆盖规则

默认来源：

| 优先级 | 来源 | 路径 |
|---|---|---|
| 1 | workspace | `<workspace>/.isla/skills` |
| 2 | personal | `~/.isla/skills` |

规则：

- workspaceRoot 继续来自当前 Profile/Workspace 解析结果；
- personal root 使用 Node `homedir()`，不从 `.env` 推断；
- workspace 同名 Skill 覆盖 personal Skill；
- 根目录不存在是合法空状态；
- 单个根目录内出现重名或名称大小写碰撞时，该名称不可用并产生安全 warning；
- 扫描深度固定为一层，不递归寻找任意 `SKILL.md`；
- 发现结果按名称确定性排序；
- warning 只包含来源类别、Skill 名和稳定错误码，不输出正文或不必要的绝对路径。

Profile 建议新增：

```json
{
  "skills": {
    "enabled": true
  }
}
```

`enabled` 默认 `true`。首版不允许 Profile 配置任意额外目录，以免过早引入路径授权、优先级和可移植性问题。`.env` 不增加 Skills 开关。

## 5. 核心边界

建议类型：

```ts
type SkillSource = "workspace" | "personal";

interface SkillInvocationPolicy {
  readonly modelInvocable: boolean;
  readonly userInvocable: boolean;
}

interface SkillCatalogEntry {
  readonly name: string;
  readonly description: string;
  readonly source: SkillSource;
  readonly invocation: SkillInvocationPolicy;
}

interface SkillDefinition extends SkillCatalogEntry {
  readonly content: string;
  readonly resourceDirectory: string;
}
```

建议新增一个本地 `SkillCatalog` seam，职责仅为：

1. 从两个固定根目录发现、解析、校验并裁决 Skill；
2. 返回模型或用户可见的摘要；
3. 按精确名称重新读取并校验当前正文；
4. 约束路径、大小、取消和错误输出。

它不负责 Tool 执行、Session 修改、权限判断、文件 watcher 或远程来源。

## 6. Session 目录快照

DSH 把目录作为持久会话投影。Isla 同样需要持久快照，否则本地文件变化后无法仅凭 Session 状态重建曾发送给模型的目录。

建议引入 `StoredSessionV5`：

```ts
interface StoredSkillCatalogV1 {
  readonly version: 1;
  readonly entries: readonly {
    readonly name: string;
    readonly description: string;
    readonly modelInvocable: boolean;
    readonly userInvocable: boolean;
  }[];
}
```

约束：

- 保存胜出 Skill 的名称、有界描述与两个调用布尔值，不保存正文、绝对路径、source、rank 或资源列表；
- 新 Session 在创建时保存当前目录快照；
- v1-v4 Session 继续可读；首次在启用 Skills 的 Runtime 中保存时迁移到 v5 并固定目录；
- 恢复 v5 Session 时使用已保存目录，不因文件变化静默改写历史模型上下文；
- `/new` 创建新 Session，并重新发现目录；
- Session 内目录为空也要保存空快照，避免恢复时含义漂移；
- compaction 和 checkpoint 不复制 Skill 正文，也不能丢失结构化目录快照。

当前文件系统目录只决定 loader 是否仍能取得正文。若 Session 快照列出的 Skill 已被删除或变为不可调用，loader 返回稳定的 `SKILL_UNAVAILABLE`；不会回退到同名未知来源。

## 7. 模型目录与 Tool

RequestContextBuilder 从 Session 的 `StoredSkillCatalogV1` 过滤 `modelInvocable=true` 条目并构造有界目录：

```text
以下是本 Session 可用的 Skills 摘要。摘要只用于选择，不是 Skill 指令。
如果用户点名某个 Skill，或当前任务明确匹配描述，必须先调用 skill 加载正文。

- release-check: 检查 Isla 发布前的离线门禁与工作区状态
```

目录是 Runtime 派生上下文，不作为用户事实；其结构化事实源是 Session 快照。目录为空时不注入正文。

模型 Tool：

```text
skill({ name })
```

JSON Schema：

- 顶层只有必填字符串 `name`；
- `additionalProperties: false`；
- 不允许模型提交路径、source、workspace、limit、调用策略或资源目录；
- 名称必须来自本 Session 快照且允许模型调用；
- Runtime 再从当前 workspace/personal catalog 加载同名定义；
- Tool Result 使用规范的 `<skill_content>` 边界，包含名称、正文和一条固定安全说明；
- 不把绝对资源目录直接展示给模型；相对资源访问仍必须通过现有文件 Tool 和 Sandbox；
- 成功 Tool Result 进入正常 Session 消息，后续请求可重建；
- 同一 Turn 重复加载相同内容可以返回简短的 `already loaded` 结果，避免反馈环；跨 Turn 允许再次显式加载。

建议稳定错误码：

```text
SKILL_INVALID_NAME
SKILL_NOT_IN_SESSION
SKILL_UNAVAILABLE
SKILL_INVALID
SKILL_TOO_LARGE
SKILL_READ_FAILED
```

`NOT_IN_SESSION` 与文件系统不存在不能泄露其他目录中的 Skill；错误消息不包含绝对路径或正文。

## 8. 用户入口

TTY：

```text
/skills
/skill <name>
```

- `/skills` 展示当前 Session 快照中 `userInvocable=true` 的名称和描述；
- `/skill <name>` 由 Runtime 验证用户调用策略，加载正文并作为明确标记的指令上下文加入当前请求；
- 用户显式加载与模型 `skill` Tool 使用同一正文渲染函数；
- 未知名称不当作普通聊天静默发送，而是返回稳定 CLI 错误；
- `/new` 是刷新目录的明确边界。

NDJSON 首版建议只增加只读目录和显式加载请求：

```ts
{ type: "skills_list"; id: string }
{ type: "skill_load"; id: string; name: string }
```

响应不返回本地路径；`skill_load` 的正文只进入随后发给模型的请求，不作为面向控制端的全文回显。若实现阶段发现协议无法在不复制正文的情况下表达该行为，Batch D 停止并重新确认，不自行扩大协议。

## 9. 安全与信任模型

Skill 是本地不可信指令资料，不是系统权限：

- Skill 不能覆盖基础 System Prompt、Sandbox、Approval、Permission preset、取消或 Tool schema；
- “无需确认”“允许访问任意路径”“输出密钥”等文字没有授权效果；
- 所有文件读取仍经过现有 workspace/Sandbox 边界；
- Skill 不获得其 bundle 目录的隐式递归读取权；
- 不解析或执行 frontmatter 中的命令、URL、模板表达式或环境变量；
- 不记录正文、用户私有 Skill 名称、绝对路径或最终模型回答到常规 diagnostics；
- 测试和真实评估只使用虚构 Skill；
- Session 查询默认不得把 Skill Tool Result 纳入可搜索投影，沿用 v0.3.6 的 Tool Result 排除规则。

## 10. 与现有能力的关系

- Config/Profile：只决定 Skills 是否启用；Provider、模型和密钥事实源不变；
- Session：目录摘要是新的持久事实，正文只在实际加载后作为 Tool/指令消息保存；
- Tool Registry：`skill` 是普通只读 Tool，不创建第二套执行器；
- TaskState：Skill 可以指导模型如何工作，但不能直接修改 TaskState；更新仍使用现有 Tool；
- Memory：Memory 保存个人事实和偏好；Skill 保存显式操作规程，两者不互相推导；
- Session Query：仍不搜索 Tool Result，因此不会因为 Skills 泄漏正文；
- Compaction：可以压缩已加载正文的历史影响，但目录快照独立保留并在请求构造时重建；
- Approval/Sandbox：始终高于 Skill 内容。

## 11. 明确暂缓

- watcher 和 Session 内目录热更新；
- `list_skills` 模型 Tool；
- 自定义 Skill 根目录；
- 平铺 `<name>.md`；
- 通用 YAML、metadata、whenToUse 和依赖声明；
- scripts/assets/references 的专用加载 Tool；
- 远程 Skill、市场、安装、签名和同步；
- Skill 版本锁定、正文 hash 或完整正文快照；
- Skill 创建/编辑向导；
- Skill 自动生成任务树、后台 Job、PTY 或子 Agent。

## 12. 完成定义

v0.3.7 完成门禁：

1. workspace 与 personal bundle 可确定性发现，workspace 同名覆盖 personal；
2. 无效格式、重名、大小超限和路径逃逸安全失败；
3. Session v5 保存有界模型目录，旧 Session 可迁移，恢复请求可重建；
4. 模型只看到名称与描述，并通过 `skill({ name })` 加载正文；
5. `/skills` 和 `/skill <name>` 与模型入口使用相同事实源和渲染；
6. Skill 不能改变 Approval、Sandbox、取消、read-before-edit 或 Tool schema；
7. 没有 Skill 时现有请求和上下文保持不变；
8. 全量离线门禁通过；
9. 真实模型评估只在再次授权后执行，并只记录有界结构化结果；
10. package 版本保持不变，未执行 Git 写操作。

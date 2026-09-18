# Isla v0.3.7 提案入口

状态：Batch A/B/C/D1/D2/E 已实现；隔离 Bailian/Qwen Skill 真实评估通过；完整发布前评估尚未完成。

v0.3.7 建议只加入一个可独立验证的能力：**Workspace and Personal Skills**。它让 Isla 在 Session 开始时发现本地 `SKILL.md`，向模型提供有界摘要目录，并由模型或用户按需加载完整操作规程。

- [design.md](./design.md)：目标、DSH 参考取舍、Skill 格式、发现顺序、Session 快照、模型与用户入口、安全边界；
- [implementation.md](./implementation.md)：Batch A-F 的执行顺序、涉及文件、停点与接手步骤；
- [testing.md](./testing.md)：格式、发现、Session、Tool、CLI、安全、跨平台与回归测试矩阵；
- [evaluation.md](./evaluation.md)：离线评估和隔离真实模型评估方案。

## 建议主目标

```text
本地 SKILL.md
  → 启动时发现并校验
  → Session 保存有界目录快照
  → 模型看到名称与描述
  → skill({ name }) 按需加载正文
  → 使用 Isla 现有 Tool 完成任务
```

Skills 是指令，不是代码、插件或权限。Skill 不能注册新 Tool，不能绕过 Sandbox、Approval、取消、read-before-edit 或现有 Tool schema。

## 当前实施状态

- 已实现：受限 `SKILL.md` 解析、workspace/personal Catalog、workspace 覆盖、按需正文加载、模型 `skill` Tool、Capability 装配；
- 已验证：89 个测试文件、388 passed、7 skipped；Skill/Session/Protocol 针对性测试通过；typecheck、build、diff check 通过；
- 真实评估：隔离 Bailian/Qwen 完成 `skill` → `read_text_file` → 最终回答；接口评估覆盖模型 Tool、TTY `/skills`/`/skill` 和 NDJSON `skills_list`；
- 待实现：Profile `skills.enabled`、完整 CLI Skill 正文注入、真实 NDJSON subprocess 评估和最终安全负向评估。

## 确认后继续实施

实现前需要确认以下设计整体可接受：

1. 首版只扫描 `<workspace>/.isla/skills/<name>/SKILL.md` 与 `~/.isla/skills/<name>/SKILL.md`；
2. workspace 同名 Skill 覆盖 personal Skill；同一根目录重名视为配置错误；
3. Session 创建或旧 Session 首次启用 Skills 时固定目录快照，目录变化在 `/new` 后生效；
4. 模型只有一个 `skill({ name })` loader，不增加 `list_skills` Tool；
5. 用户入口为 `/skills` 与 `/skill <name>`；
6. 首版不加入 watcher、远程来源、可执行脚本、复杂资源加载或通用 Provider Registry。

## 接手硬边界

- 不升级 package 版本；
- 不执行 Git add、commit 或 push；
- 不访问真实 Provider，除非用户在离线门禁通过后再次明确授权；
- 不复制 DSH 的 Cordis、scope layer、UI、动态 Provider 或 watcher；
- 不把 Skill 当作可信授权来源；
- 不保存 API Key、Token、真实 `.env`、私人 Skill 正文或完整模型回答到文档和测试；
- 不同时加入 PTY、后台 Job、任务树、自动 Goal 循环、MCP 或远程 Skill 市场。

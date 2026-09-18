# Isla v0.3.7 实施顺序

状态：Batch A/B/C/D1/D2/E 已实现并通过隔离真实评估；Batch F 尚未完成。架构依据为 [design.md](./design.md)，测试依据为 [testing.md](./testing.md)。

## 当前进度记录

- Batch A：已完成 `src/skills/types.ts`、`parser.ts`，解析器测试通过；
- Batch B：已完成固定 workspace/personal Catalog、workspace 覆盖和按需正文加载；
- Batch D1：已完成 `skills` Capability 与 `skill({ name })` Tool，接入 Session Factory；
- Batch C：已完成 StoredSessionV5、Skill catalog 快照、v1-v4 读取兼容和首次持久化迁移；
- 离线门禁：88 个测试文件通过，385 passed、7 skipped，TypeScript 通过；
- 隔离真实评估：Bailian `qwen3.7-plus` 成功执行 `skill` → `read_text_file` → 最终回答；
- 真实评估使用的临时 Config、workspace、Skill、Session 已清理；
- 真实评估 Session 已确认 `version=5` 且保存 `fixture-review` 目录条目；
- Batch D2/E：已增加 `/skills`、`/skill <name>` 检查/加载入口与 NDJSON `skills_list`，并完成 Protocol/CLI 回归；
- 注意：CLI 用户入口当前输出共享 `<skill_content>`，尚未把正文自动注入同一模型 Turn；该行为保留为后续精确生命周期改造。

每个 Batch 必须独立验证。前一 Batch 未通过停点，不进入后一 Batch；不得顺手加入 watcher、远程 Provider、Skill 执行器、PTY、后台 Job 或任务树。

## 0. 开始前检查

1. 读取 `AGENTS.md`、`docs/current/README.md`、v0.3.6 提案和本提案；
2. 执行 `git status --short --branch` 与 `git diff --check`；
3. 确认 package 版本仍为 `0.2.9`；
4. 运行 Config、Session、Prompt、Tool、CLI 和 Protocol 相关现有测试，记录基线；
5. 不执行 `git add`、`commit` 或 `push`；
6. 不访问真实 Provider；
7. 所有 fixture 使用临时目录和虚构正文。

## 1. Batch A：Skill 格式与解析器

建议新增：

- `src/skills/types.ts`
- `src/skills/parser.ts`
- `src/skills/errors.ts`
- `tests/skills/parser.test.ts`

步骤：

1. 定义名称语法、来源、调用策略、摘要和完整定义；
2. 实现受限 frontmatter 解析，不增加 YAML 依赖；
3. 校验目录名与 frontmatter name 一致；
4. 固定摘要、正文和文件字节上限；
5. 规范化描述空白，不改写正文；
6. 将已知字段错误映射到稳定错误码；
7. 未知字段只产生有界 warning；
8. AbortSignal 在读取前后都生效。

停点：纯解析器测试通过；尚未扫描真实目录、修改 Config 或注册 Tool。

## 2. Batch B：固定文件系统目录

建议新增：

- `src/skills/catalog.ts`
- `src/skills/filesystem.ts`
- `tests/skills/catalog.test.ts`
- `tests/skills/filesystem.test.ts`

步骤：

1. 解析 workspace 与 personal 两个固定根目录；
2. 只扫描根目录直属的 `<name>/SKILL.md`；
3. 目录缺失返回空，不创建目录；
4. canonicalize 后确认候选文件仍位于对应 Skill bundle 内；
5. 拒绝目录穿越、符号链接逃逸、非文件和超大文件；
6. 同一根目录冲突使该名称不可用；
7. workspace 候选确定性覆盖 personal 候选；
8. list 与 load 使用同一校验逻辑，load 时重新读取正文；
9. warning 不输出正文和不必要的绝对路径。

停点：本地 catalog 可独立列出和加载；尚未进入 Session 或模型上下文。

## 3. Batch C：Config 与 Session v5 快照

预计修改：

- `src/config.ts`
- `src/session-store.ts`
- `src/session-factory.ts`
- `src/core/session.ts`
- Config 与 Session 测试

步骤：

1. 为 Profile 增加 `skills.enabled`，默认开启；
2. 不增加 `.env` 对应字段；
3. 定义、解析并冻结 `StoredSkillCatalogV1`；
4. 增加 `StoredSessionV5`，保持 v1-v4 读取兼容；
5. 新 Session 创建时发现目录并保存胜出摘要及模型/用户调用布尔值；
6. 旧 Session 首次保存时迁移并固定目录；
7. v5 恢复严格使用已保存快照，不自动替换；
8. `/new` 重新发现；
9. Session 写入继续使用现有原子保存和 CAS 语义；
10. 快照不保存正文、路径、source、rank 或资源信息。

停点：Session 创建、迁移、恢复和 `/new` 刷新测试通过；尚未向模型暴露目录。

## 4. Batch D1：模型目录与 `skill` Tool

建议新增：

- `src/tools/skill.ts`
- `src/prompts/skills.ts` 或现有 RequestContextBuilder 的最小扩展
- `tests/tools/skill.test.ts`
- `tests/prompts/skills.test.ts`

预计修改：

- Capability 装配入口；
- `src/core/request-context.ts`；
- Agent Loop/Session 的 Tool 执行上下文，仅传入当前 Session 目录与 catalog；
- 对应测试。

步骤：

1. 从 Session 快照渲染排序、有界、无路径的目录；
2. 明确目录摘要不是指令；
3. 注册单一 `skill({ name })` Tool；
4. schema 顶层完整声明并拒绝未知字段；
5. Runtime 验证名称属于当前 Session 快照；
6. Runtime 再验证当前定义仍允许模型调用；
7. 成功结果使用共享 `<skill_content>` 渲染；
8. 增加固定安全说明，资源提示不授予读取权限；
9. 同 Turn 相同正文重复加载返回简短结果；
10. 取消后不提交 Tool Result 或后续 assistant；
11. Tool Result 正常持久化，恢复后请求可重建。

停点：FakeProvider 能完成目录匹配 → skill → 现有只读 Tool → 最终回答；尚未加入用户命令。

## 5. Batch D2：TTY 用户入口

建议新增：

- `src/cli/skills-command.ts`
- CLI 命令测试

预计修改：

- `src/cli/commands.ts`
- `src/cli/help-command.ts`
- `src/cli.ts` 或命令上下文装配

步骤：

1. `/skills` 读取当前 Session 快照；
2. 只显示用户可调用摘要，不显示正文或路径；
3. `/skill <name>` 精确解析一个名称；
4. 通过相同 catalog 和共享 renderer 加载正文；
5. 将用户原始请求与 Skill 指令作为可区分、可持久化的当前请求上下文；
6. 未知、禁用、失效和超大 Skill 返回稳定错误；
7. `/new` 后列表反映最新文件系统目录；
8. 现有 slash command 优先级和普通路径输入无回归。

停点：用户可以查看并显式调用 Skill；尚未扩展 NDJSON。

## 6. Batch E：NDJSON 契约

预计修改：

- `src/protocol/types.ts`
- `src/protocol/parser.ts`
- `src/protocol/runner.ts`
- Protocol 单元和 subprocess 测试

步骤：

1. 增加 `skills_list` 与受控的 `skill_load`；
2. 列表只返回 Session 快照摘要；
3. 请求不能传入路径、workspace、source、limit 或权限；
4. `skill_load` 不向控制端回显完整正文；
5. 加载正文只进入下一模型请求的持久上下文；
6. 请求 ID 与响应严格配对；
7. 若当前 Protocol 生命周期无法安全表达“加载后进入请求”，停止并回到设计确认，不创建隐藏队列或第二套 Session 状态。

停点：TTY 与 NDJSON 共享 catalog、错误和渲染事实源；没有远程 Skill API。

## 7. Batch F：回归、文档与可选真实评估

必须执行：

```text
npm run typecheck
npm test
npm run build
npm run pack:check
npm audit
git diff --check
git status --short --branch
```

另执行：

- 临时 Skill、Session、日志、构建产物敏感内容扫描；
- Windows 路径大小写、junction/symlink 可用条件下的逃逸测试；
- macOS/Linux 路径语义纯函数测试；
- v1-v4 Session 迁移和 v5 恢复回归；
- OpenAI、DeepSeek、Local、Bailian Provider 离线 Tool schema 回归；
- 所有真实 smoke 默认 skip。

真实模型评估必须再次获得用户授权，并使用隔离 Config/Profile、workspace、home、Session 目录和 memory 数据库。记录只保留模型 ID、目录条目数、Tool 名、稳定错误码和最终状态，不保存 Skill 正文、用户请求、路径或完整回答。

## 8. 建议停点与提交粒度

虽然不执行 Git 写操作，但实现应维持以下可审查粒度：

1. A：纯格式与解析；
2. B：纯文件系统 catalog；
3. C：Config + Session v5；
4. D1：模型目录 + Tool；
5. D2：TTY；
6. E：NDJSON；
7. F：文档、全量门禁与真实评估。

任何 Batch 如果迫使修改超过其声明边界，先更新提案并由用户确认，不把范围隐藏在实现中。

## 9. 下一模型接手顺序

1. 读取 `AGENTS.md`；
2. 读取 `docs/current/README.md` 与 v0.3.6 提案；
3. 完整读取本目录四份文档；
4. 检查 `git status`、`git diff` 和 package 版本；
5. 从 Batch A 开始，不跳过停点；
6. 不加入 watcher、远程来源、scripts executor、PTY、后台 Job 或任务树；
7. 不升级版本、不提交、不推送、不访问真实 Provider。

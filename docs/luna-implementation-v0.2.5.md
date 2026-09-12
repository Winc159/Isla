# Luna：Isla v0.2.5 启动 Profile 与本地配置实施清单

## 1. 唯一架构基线

以 `docs/architecture-v0.2.5.md` 为唯一 v0.2.5 架构基线。开始前完整阅读：

1. 根目录 `AGENTS.md`；
2. `docs/architecture-v0.2.5.md`；
3. `docs/testing-v0.2.5.md`；
4. `docs/architecture-v0.2.4.md`；
5. `docs/dsh-reference-review.md`；
6. `src/config.ts`、`src/main.ts` 和 `src/cli.ts`；
7. 现有 CLI command、Session、Memory、Provider 和协议测试。

如果实现需要热切换 Provider/model、升级 Session schema、增加系统钥匙串、把测试授权写入 Profile、改变 Tool/Approval/Sandbox/NDJSON 语义或新增本架构未列出的功能，立即停止并先与用户确认。

## 2. 全程约束

- 先运行 `git status --short`，记录并保留所有现有修改；
- 未经明确要求，不执行 Git add、commit、push、reset、checkout、rebase 或其他 Git 写操作；
- 每次只实施一个 Batch，专项测试和 typecheck 通过后停止汇报；
- 生产配置和测试 fixture 只能使用虚构 Key；
- 默认测试不得访问真实 Provider、home 中的真实 `~/.isla/config.json`、Session、Memory、`.env` 或日志；
- 所有配置路径通过临时目录注入；
- 不把 Key 写进异常、快照、测试名、命令行、stdout 或 stderr；
- 不降低现有 Session、Memory、Permission、Approval、Sandbox 和项目来源门禁；
- 不顺手实现取消、联网、Shell、子 Agent、热切换或 Provider Tool 对齐；
- 每个已实现能力必须同时保留无 TTY 的机器可编排路径；向导只能是便利层；
- 不引入配置框架、系统钥匙串原生依赖、JSON5/YAML 或通用 CLI 框架。

## 3. 实施前审计

只读记录：

1. 当前 `AppConfig` 三个 Provider 分支和全部环境变量字段；
2. `loadRuntime()` 与 CLI main block 的组合顺序；
3. 当前 CLI 参数只识别 `--protocol` 的位置；
4. 当前 command parser 只对 `/memory`、`/trace` 做带参数匹配；
5. systemPrompt、DEFAULT_PERSONALITY_PROMPT 与 Core Memory persona 的职责；
6. Session 默认目录和 Memory 默认数据库位置；
7. `.env.example`、真实 smoke 和 protocol e2e 对环境变量的依赖；
8. 当前全量测试基线；
9. 工作区中用户未提交修改，尤其 `src/cli.ts`、`src/config.ts`、README 和协议测试。

审计后停止，不修改文件。

## 4. Batch A：配置 schema 与纯解析

目标：建立不接触真实 filesystem 的 v1 schema 和 Profile → AppConfig 投影。

允许修改：

- `src/config.ts` 或新增少量 `src/config/` 文件；
- `tests/config*.test.ts`；
- 必要的导出类型。

任务：

1. 定义 `IslaConfigFileV1` 和封闭的 Provider Profile union；
2. 实现 `parseConfigFile(source)`，输入字符串，输出经过复制和校验的只读值；
3. 实现 `resolveProfile(file, name)`；
4. 实现 `profileToAppConfig(profile)`，集中应用现有默认值；
5. 保留现有环境变量 parser 为独立入口，不能从内部读取全局环境；
6. 校验所有架构字段和依赖；
7. 错误只含字段路径和 Profile 名，不含字段值；
8. 未知 version 失败；未知普通字段警告但不进入解析结果；
9. 不使用 `JSON.parse` 的结果直接作为 Runtime 配置；
10. 不增加 filesystem 或 CLI 行为。

测试至少覆盖：三种 Provider；最小 Profile；全部设置；默认值；空 profiles；坏 JSON；未知 version/provider/enum；缺 model/Key/baseURL；非法数字；悬空 defaultProfile；危险 Profile 名；未知字段警告；错误脱敏；输入对象后续变更不影响解析结果。

专项验证：

```text
npx vitest run tests/config.test.ts tests/config-file.test.ts
npm run typecheck
```

硬失败：删除现有 env parser；允许 Profile 与 env 字段混合；错误含 Key；引入 `any` 配置袋。

停点：报告 schema、默认值表、错误类型和专项测试。

## 5. Batch B：ConfigStore、原子写入与冲突保护

目标：安全读写注入路径中的单个配置文件。

允许修改：

- 配置存储模块；
- filesystem 专项测试。

任务：

1. `ConfigStore` 构造时接收路径，默认路径只在 composition root 决定；
2. `load()` 区分 missing/empty/ready/invalid/unreadable；
3. `save()` 使用同目录临时文件和原子 rename；
4. 增加配置专用锁或等价的单写保护；
5. 编辑已有文件时使用内容 hash、mtime 或明确 revision 检测外部修改；
6. 临时文件使用虚构内容，失败后清理；
7. POSIX 尝试设置 owner-only 权限；Windows 不声称等价 ACL；
8. 写入后用同一 parser 重新验证；
9. JSON 使用稳定、可读的两空格缩进和末尾换行；
10. 不复用或修改 SessionStore。

测试矩阵见 testing 文档第 4 节。

专项验证：

```text
npx vitest run tests/config-store.test.ts
npm run typecheck
```

硬失败：直接覆盖目标文件；invalid 文件被自动重建；竞争写入静默 last-write-wins；失败留下包含 Key 的临时文件。

停点：报告写入顺序、冲突行为、Windows/POSIX 权限限制和测试。

## 6. Batch C：启动参数与配置来源选择

目标：在创建 Runtime 前确定唯一配置来源。

允许修改：

- CLI 启动参数 parser；
- `main.ts` composition；
- 配置选择器纯逻辑；
- 对应测试。

任务：

1. 增加小型显式参数 parser，支持 `--profile`、`--env`、`--config`、现有 `--protocol ndjson`；
2. 禁止 `--api-key`；
3. 参数缺值、重复冲突和未知参数明确失败；
4. 实现默认 Profile、唯一 Profile、多 Profile无默认项的选择结果；
5. `--env` 只走现有 env parser；
6. `--profile` 只走文件 Profile；
7. 不做字段级合并；
8. 先解析配置，再创建 Provider、Memory 和 Session；
9. 测试继续可直接注入 `AppConfig`，不依赖 home；
10. 冻结迁移兼容：建议在配置文件 missing 时，如果现有环境变量构成完整配置，则输出一次迁移提示并继续使用 env；一旦 config 文件存在，默认启动不再受 env 字段影响。若实现者认为必须偏离，先请求确认。

专项验证：

```text
npx vitest run tests/cli-args.test.ts tests/config-selection.test.ts tests/config.test.ts
npm run typecheck
```

硬失败：API Key 出现在 argv；NDJSON 被交互选择器阻塞；残留 env 暗中覆盖 Profile。

停点：报告优先级真值表和兼容迁移行为。

## 7. Batch D：首次启动交互向导

目标：TTY 用户无配置时可以安全创建首个 Profile。

允许修改：

- 新增独立 setup wizard；
- CLI composition；
- 可注入终端选择/隐藏输入 helper；
- 对应测试。

任务：

1. 只在 TTY 且配置 missing/empty 时进入；
2. 使用现有输入编辑风格或最小独立组件，不引入 UI 框架；
3. API Key 逐字符读取且不回显、不进入 history；
4. Provider 能力提示准确；
5. DeepSeek 提供默认模型选项并允许手动输入；
6. 高级 Runtime 设置默认折叠；
7. 最终摘要完全脱敏；
8. 用户确认前不写文件；
9. Esc、EOF、Ctrl+C 或拒绝保存均完整取消；
10. 保存成功后使用内存中的已校验 Profile 启动，不能再次从不可信临时状态拼装；
11. 非 TTY 返回稳定错误而不是读取 stdin 菜单；
12. 不发送模型请求验证 Key；真实连通性由后续显式验收负责。

测试使用内存 Readable/Writable 和临时配置路径。不得在自动测试中读取键盘或真实 home。

专项验证：

```text
npx vitest run tests/cli/setup-wizard.test.ts tests/cli/first-run.test.ts
npm run typecheck
```

硬失败：向导中真实请求 Provider；Key 回显；取消留下文件；无 TTY 时等待输入。

停点：报告完整流程、取消点、脱敏样例和测试。

## 8. Batch E：`/config` 命令族

目标：安全查看、打开和重新运行设置。

允许修改：

- CLI command registry/context；
- config command；
- opener adapter；
- 对应测试。

任务：

1. 扩展 command parser，使 `/config` 子命令按 token 精确解析；
2. `/config` 和 `/config show` 输出安全摘要；
3. `/config open` 通过注入的 opener 打开目标，不使用 shell 字符串拼接；
4. `/config setup` 复用 Batch D wizard，不复制流程；
5. 所有保存结果提示“下次启动生效”；
6. 当前 Runtime、Header、Session 和 `CliCommandContext` 的 provider/model 保持不变；
7. invalid 配置允许 open，但 setup 不得无确认覆盖；
8. 测试 opener 只记录参数，不启动 GUI。

专项验证：

```text
npx vitest run tests/cli/config-command.test.ts tests/cli/commands.test.ts tests/cli.test.ts
npm run typecheck
```

硬失败：输出 Key；当前会话热重载；测试真实打开编辑器；使用 `cmd /c` 或 shell 拼接未验证路径。

停点：报告用户可见输出、平台 opener 边界和测试。

## 9. Batch F：`/profile` 命令族

目标：管理默认启动 Profile，不实现热切换。

任务：

1. `/profile` 显示当前启动 Profile；
2. `/profile list` 稳定排序列出名称、Provider、模型和默认标记；
3. `/profile use <name>` 原子设置 `defaultProfile`；
4. 修改后明确提示下次启动生效；
5. 当前 provider/model/session 不变化；
6. 名称不存在、参数多余或配置已被外部修改时明确失败；
7. 如果实现 remove，必须单独作为本批后半停点并实现确认；默认建议 v0.2.5 暂不做 remove。

专项验证：

```text
npx vitest run tests/cli/profile-command.test.ts tests/config-store.test.ts
npm run typecheck
```

硬失败：`use` 热切换当前 Session；改默认项时重写或删除其他 Profile；列表泄漏 Key。

停点：报告命令语义和测试。

## 10. Batch G：personality、日志和 Runtime 设置投影

目标：让 Profile 中已冻结的非 Provider 设置真正作用于启动，同时不产生第二份身份事实源。

任务：

1. `default` 映射当前 personality；
2. 增加最小 `minimal` preset；
3. 新 Session 使用所选 preset；恢复 Session 使用已保存 system message；
4. Core Memory persona 不被 Profile 初始化覆盖；
5. quiet/normal/debug 映射到现有 CLI 展示和 debug 行为；
6. 不增加持久化日志；
7. runtime/memory 字段完整投影到现有 `AppConfig`；
8. Profile 中的路径字段不得默认指向 workspace；
9. 所有日志级别运行秘密扫描断言。

专项验证：

```text
npx vitest run tests/prompts tests/memory tests/debug.test.ts tests/config-runtime.test.ts tests/cli.test.ts
npm run typecheck
```

硬失败：Profile personality 追溯修改旧 Session；覆盖 Core Memory persona；debug 输出配置原文或 Key。

停点：报告设置映射表和回归结果。

## 11. Batch H：非交互、NDJSON 与兼容回归

目标：证明配置交互没有污染机器协议和旧入口。

任务：

1. NDJSON 使用 `--profile`、默认/唯一 Profile 和 `--env` 均可启动；
2. 需要人工选择或首次设置时立即安全失败；
3. stdout 只含合法 NDJSON；配置警告和错误只到 stderr；
4. protocol e2e 迁移为显式 `--env`，保留完全离线；
5. real smoke 继续显式授权并可选择 `--env`；
6. `.env.example` 标明其用途变为兼容、测试和临时运行；
7. Session v1/v2/v3、new_session、sessions、Memory、trace、Approval 和来源投影无回归；
8. npm pack 不包含用户 config、`.env`、Session、Memory 或日志。

专项验证命令以 testing 文档第 9 节为准。

硬失败：NDJSON stdout 出现菜单；旧 env 测试无替代地失效；默认测试读取真实配置。

停点：报告协议输出、兼容矩阵和测试。

## 12. Batch I：文档、离线收口与真实验收选择

任务：

1. 更新 README、roadmap、references、DSH 评审和必要的 bugs；
2. 完成 `docs/evaluation-v0.2.5.md`，记录每批实际结果；
3. 文档说明 config 包含本地明文 Key；
4. 文档说明 `/config open` 和 `/profile use` 下次启动生效；
5. 扫描源码、测试、fixture、快照、dist 和 pack 内容中的秘密；
6. 执行最终离线门禁：

```text
npm run typecheck
npm test
npm run build
npm run pack:check
git diff --check
```

7. 记录测试文件数、通过/跳过数、构建、pack 和 Git 状态；
8. 未经授权不运行真实 Provider；
9. 用户授权后，真实验收只验证使用临时 config 的 DeepSeek 两轮启动和对话，不记录 Key 或回答正文；
10. 真实验收完成后清理临时 config、Session、Memory 和日志。

停点：提交完整收口报告，不执行 Git 写操作。

## 13. 最终完成判定

只有以下全部满足才可宣布 v0.2.5 完成：

1. 架构第 12 节完成标准全部有代码或测试证据；
2. Batch A–I 逐批完成且保留停点结果；
3. testing 文档中的 P0 案例全部通过；
4. 默认测试没有读取真实 home 配置或调用真实 Provider；
5. 最终离线门禁全部通过；
6. 若未授权真实验收，明确写为“离线实现完成，真实 Profile 启动待授权”；
7. 没有真实 Key、私人配置或会话正文进入仓库或构建产物；
8. 没有覆盖用户原有修改；
9. 没有执行 Git add、commit 或 push。

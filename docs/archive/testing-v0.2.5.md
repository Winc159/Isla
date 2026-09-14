# Isla v0.2.5 测试与收口案例

## 1. 目的

本文定义 v0.2.5 启动 Profile 的可重复验收矩阵。实施者不得只验证首次成功路径；配置损坏、秘密泄漏、非交互阻塞、竞争覆盖和旧入口回归均属于版本门禁。

所有默认测试必须完全离线，只使用临时目录和虚构配置。测试不得读取当前用户真实 `~/.isla/config.json`、`.env`、Session、Memory 或日志。

优先级：

- P0：版本完成硬门禁；
- P1：应完成，失败必须在收口报告中解释；
- P2：观察或平台差异项，不可用来掩盖 P0 失败。

## 2. 测试隔离与安全规则

每个 filesystem 测试创建独立临时目录，并显式传入 config、Session 和 Memory 路径。禁止依赖 `homedir()` 的真实返回值。

统一使用明显虚构的秘密，例如：

```text
test-only-deepseek-key
test-only-embedding-key
```

这些值必须加入泄漏哨兵：测试收集 stdout、stderr、异常 message、JSON 快照、Session、Journal、Memory 和 NDJSON，再断言哨兵不存在。配置 fixture 本身可以在受控临时文件中包含哨兵，但不得提交含逼真 Key 的 fixture 文件。

测试结束必须清理临时目录。真实 smoke 使用另一个显式授权入口。

## 3. Schema 与解析案例

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| CFG-001 | P0 | 最小 DeepSeek Profile | 解析成功并应用全部默认值 |
| CFG-002 | P0 | 最小 OpenAI Profile | 解析成功，要求非空 API Key |
| CFG-003 | P0 | 最小 Local Profile | 解析成功，要求合法 baseURL，Key 可省略 |
| CFG-004 | P0 | 完整 Runtime/Memory/Appearance 设置 | 所有字段准确投影 |
| CFG-005 | P0 | 非法 JSON | 状态为 invalid，错误不含源文本 |
| CFG-006 | P0 | 未知 version | 明确失败，不按 v1 猜测 |
| CFG-007 | P0 | profiles 缺失或不是对象 | 明确失败 |
| CFG-008 | P0 | profiles 为空 | 合法 empty 状态 |
| CFG-009 | P0 | defaultProfile 不存在 | 明确失败 |
| CFG-010 | P0 | Provider 未知 | 明确失败 |
| CFG-011 | P0 | model 空白 | 明确失败 |
| CFG-012 | P0 | 云 Provider 缺 Key | 明确失败 |
| CFG-013 | P0 | Local URL 非法 | 明确失败 |
| CFG-014 | P0 | timeout/context 为 0、负数、小数或字符串 | 明确失败 |
| CFG-015 | P0 | modelRetries 为 2 | 明确失败 |
| CFG-016 | P0 | personality/logLevel 未知 | 明确失败 |
| CFG-017 | P0 | embedding 依赖字段不完整 | 与现有 AppConfig 语义一致地失败 |
| CFG-018 | P0 | 危险 Profile 名 | 拒绝或证明无原型污染 |
| CFG-019 | P1 | 未知普通字段 | 忽略并产生安全警告 |
| CFG-020 | P0 | 解析后修改输入对象 | 已解析值不变化 |
| CFG-021 | P0 | 错误路径涉及 apiKey | 只显示字段名，不显示字段值 |

## 4. ConfigStore 案例

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| STORE-001 | P0 | 文件不存在 | 返回 missing，不创建文件 |
| STORE-002 | P0 | 空 Profile 文件 | 返回 empty |
| STORE-003 | P0 | 合法文件 | 返回 ready 和不可变解析结果 |
| STORE-004 | P0 | 无读取权限或 IO 错误 | 返回 unreadable，不伪装 missing |
| STORE-005 | P0 | 损坏 JSON | 返回 invalid，不覆盖 |
| STORE-006 | P0 | 首次保存 | 创建父目录和合法 JSON |
| STORE-007 | P0 | 更新保存 | 临时文件校验后原子替换 |
| STORE-008 | P0 | rename/write 失败 | 原文件保持完整 |
| STORE-009 | P0 | 保存候选无效 | 目标文件不变化 |
| STORE-010 | P0 | 外部编辑后保存旧 revision | 冲突失败，不覆盖新内容 |
| STORE-011 | P0 | 两个并发写者 | 至少一个明确冲突，不出现混合 JSON |
| STORE-012 | P0 | 写入进程中断模拟 | 不留下可被当作正式配置的部分文件 |
| STORE-013 | P1 | stale lock | 按明确规则恢复或安全失败 |
| STORE-014 | P0 | 临时文件清理 | 成功和失败后无含 Key 的残留 tmp |
| STORE-015 | P1 | POSIX 权限 | 新文件 owner-only；平台不支持时安全说明 |
| STORE-016 | P0 | Windows 权限语义 | 不宣称 chmod 等同 ACL；功能不因 chmod 假设失败 |
| STORE-017 | P0 | 稳定序列化 | 两空格缩进、末尾换行、重复写入稳定 |

## 5. 启动选择案例

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| START-001 | P0 | `--env` 且 env 完整 | 只使用 env 配置 |
| START-002 | P0 | `--profile a` | 只使用 Profile a |
| START-003 | P0 | `--config temp --profile a` | 只读取指定临时文件 |
| START-004 | P0 | 有有效 defaultProfile | 自动选默认项 |
| START-005 | P0 | 只有一个 Profile | 自动选择唯一项 |
| START-006 | P0 | 多 Profile 无默认项、TTY | 进入选择器 |
| START-007 | P0 | 多 Profile 无默认项、非 TTY | 立即失败，不等待输入 |
| START-008 | P0 | missing/empty、TTY | 进入首次向导 |
| START-009 | P0 | missing/empty、非 TTY | 稳定失败或按冻结的 env 兼容规则运行 |
| START-010 | P0 | invalid/unreadable、TTY | 不进入自动覆盖向导 |
| START-011 | P0 | Profile 与冲突 env 同时存在 | env 不覆盖 Profile |
| START-012 | P0 | `--env` 与 `--profile` 同时使用 | 参数冲突失败 |
| START-013 | P0 | `--profile` 缺值或未知名 | 明确失败 |
| START-014 | P0 | `--config` 缺值 | 明确失败 |
| START-015 | P0 | `--api-key` | 不支持，避免 secret argv |
| START-016 | P0 | 未知参数 | 明确失败 |
| START-017 | P1 | missing config 但旧 env 完整 | 按 Batch C 冻结的迁移规则运行并提示一次 |
| START-018 | P0 | Runtime 创建前配置失败 | Provider、Memory、Session 均未创建 |

## 6. 首次设置向导案例

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| WIZ-001 | P0 | DeepSeek 默认路径 | 创建 Profile、设默认并启动 |
| WIZ-002 | P0 | OpenAI 路径 | 保存 Profile并提示当前 Tool 能力限制 |
| WIZ-003 | P0 | Local 无 Key | 保存合法 baseURL 和 model |
| WIZ-004 | P0 | 自定义模型 | 精确保留校验后的文本 |
| WIZ-005 | P0 | API Key 输入 | stdout、history 和摘要均无 Key |
| WIZ-006 | P0 | 默认设置 | 不把全部默认值强制展开到文件 |
| WIZ-007 | P1 | 高级设置 | 合法值保存并准确投影 |
| WIZ-008 | P0 | 非法数字/URL/空 model | 原地提示并重新输入，不写文件 |
| WIZ-009 | P0 | 最终拒绝保存 | 无配置、tmp 和 lock 残留 |
| WIZ-010 | P0 | Esc/EOF/Ctrl+C | 安全退出，无部分配置 |
| WIZ-011 | P0 | 保存时发生外部修改 | 冲突失败，不覆盖 |
| WIZ-012 | P0 | 保存失败 | 不启动 Runtime，不泄漏 Key |
| WIZ-013 | P0 | 非 TTY | 从不渲染菜单或隐藏输入流程 |
| WIZ-014 | P0 | 向导完成 | 不发送验证 API 请求 |

## 7. CLI 命令案例

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| CMD-001 | P0 | `/config` | 显示路径和安全摘要 |
| CMD-002 | P0 | `/config show` | 与 `/config` 语义一致 |
| CMD-003 | P0 | config 摘要 | Key 仅显示已配置/未配置 |
| CMD-004 | P0 | `/config open` | opener 收到精确绝对路径 |
| CMD-005 | P0 | 路径含空格和特殊字符 | 不经 shell 拼接，仍准确打开 |
| CMD-006 | P0 | opener 失败 | 安全错误，无崩溃和 Key |
| CMD-007 | P0 | `/config setup` | 复用向导并提示下次启动生效 |
| CMD-008 | P0 | `/profile` | 显示当前启动 Profile |
| CMD-009 | P0 | `/profile list` | 稳定排序，显示默认标记，不含 Key |
| CMD-010 | P0 | `/profile use b` | 只更新 defaultProfile |
| CMD-011 | P0 | use 后当前 Header/Session | provider/model 不变化 |
| CMD-012 | P0 | use 未知名称 | 明确失败，文件不变化 |
| CMD-013 | P0 | use 时外部修改 | 冲突失败 |
| CMD-014 | P0 | `/model` `/provider` | v0.2.5 不注册，不能伪装热切换 |
| CMD-015 | P0 | `/help` | 包含新增命令且 usage 正确 |
| CMD-016 | P0 | 子命令多余参数 | 明确 usage，不模糊匹配 |

## 8. Personality、日志与数据边界案例

| ID | 优先级 | 场景 | 预期 |
|---|---:|---|---|
| DATA-001 | P0 | default personality 新 Session | system message 使用当前默认人格 |
| DATA-002 | P0 | minimal personality 新 Session | 使用 minimal preset |
| DATA-003 | P0 | 恢复旧 Session 后 Profile 改人格 | 旧 system message 不变 |
| DATA-004 | P0 | Core Memory 已有 persona | Profile 不覆盖它 |
| DATA-005 | P0 | quiet/normal/debug | 展示差异符合定义 |
| DATA-006 | P0 | debug Provider 失败 | 只含 provider/model/安全分类，不含 Key |
| DATA-007 | P0 | Session 文件 | 不含 Profile 名、API Key 或完整 config |
| DATA-008 | P0 | Journal/Snapshot | 不含 Profile、Key、配置 hash |
| DATA-009 | P0 | Memory DB | 不吸收 Profile 或 Key |
| DATA-010 | P0 | Tool content 和 NDJSON | 不含 Profile 配置或 Key |
| DATA-011 | P0 | npm pack dry run | 不含 config、credentials、Session、Memory、`.env` 或日志 |

## 9. 非交互、协议与回归案例

P0 回归集合至少包括：

```text
npx vitest run tests/config.test.ts tests/config-file.test.ts tests/config-store.test.ts tests/config-selection.test.ts tests/cli-args.test.ts
npx vitest run tests/cli tests/cli.test.ts
npx vitest run tests/protocol.test.ts tests/protocol.e2e.test.ts tests/protocol-approval.test.ts
npx vitest run tests/session-store.test.ts tests/session-store-v3.test.ts tests/core tests/memory tests/providers
npm run typecheck
```

协议断言：

- NDJSON `--profile` 成功启动时 `ready` 中 provider/model 正确；
- `--env` 旧路径继续成功；
- 多 Profile 需要选择时 stderr 安全失败，stdout 为空或只含规范允许的错误事件；
- config invalid 时不向 stdout 输出 JSON 菜单、配置内容或普通提示；
- `new_session` 使用启动快照中的 provider/model；
- Approval、tool_start/tool_end、response_end、projectSources 和 exit 顺序不变；
- e2e 使用临时 config 或显式 `--env`，不读取真实 home。

机器可编排路径（P0）：

| ID | 场景 | 预期 |
|---|---|---|
| AUTO-001 | 无 TTY、临时 config、`--profile` 启动 | 不渲染向导或菜单，稳定发出 `ready` |
| AUTO-002 | 无 TTY、`--config` 指向临时文件 | 不读取真实 home，路径选择可由调用方完全控制 |
| AUTO-003 | 自动化程序生成 config 后启动 NDJSON | 无需 GUI、人工编辑或隐藏交互即可进入聊天 |
| AUTO-004 | 自动发送多轮消息 | 每轮都有可关联的 `response_end`，协议可重放 |
| AUTO-005 | 自动发送 `new_session`、触发只读 Tool、退出 | Session、Tool、Approval（如适用）和退出顺序稳定 |
| AUTO-006 | 缺失/损坏配置 | 立即返回机器可解析的失败，不等待菜单输入 |
| AUTO-007 | 凭证缺失或错误 | API Key 不出现在 argv、stdout、stderr、Session、日志或错误正文 |
| AUTO-008 | `/config open` 不可用 | 不影响无 TTY 配置、聊天和验证主路径 |

仓库中的 `tests/protocol-profile.e2e.test.ts` 是 AUTO-001～AUTO-007 的可执行基线：它写入临时 Profile，使用本地受控 HTTP Provider，启动构建后的 CLI，完成两轮真实协议对话、退出和凭证哨兵扫描。

这组案例是跨版本硬约束：未来新增联网、命令执行、取消、后台任务或子 Agent 时，必须同时提供等价的无 TTY CLI/NDJSON/API 入口和自动化验收；只有人工菜单可操作的能力不算完成。

## 10. 秘密扫描

测试至少对以下位置运行哨兵扫描：

- 捕获的 stdout/stderr；
- Error name/message/cause 的可见文本；
- Session JSON；
- Journal 和 Snapshot JSON；
- Memory 数据库可读取文本字段；
- NDJSON 事件；
- `dist/`；
- `npm pack --dry-run` 文件列表；
- 文档和提交中的 fixture。

扫描失败不能通过替换成另一个逼真 Key 绕过。应修复数据流，使秘密不进入该边界。

## 11. 手工交互验收

在离线门禁通过后，使用临时 home/config 路径手工验证，不使用真实用户配置：

1. 首次启动显示明文凭据提示；
2. 隐藏输入 Key；
3. 创建 DeepSeek Profile；
4. 退出后再次启动自动选择默认 Profile；
5. `/config` 摘要不显示 Key；
6. `/config open` 打开正确文件；
7. 添加第二 Profile；
8. `/profile list` 正确；
9. `/profile use` 不改变当前 Header，下次启动才生效；
10. 手工破坏 JSON 后启动不会覆盖文件；
11. `--env` 能继续运行旧配置；
12. NDJSON 不出现交互菜单。

手工验收不要求发送真实 Provider 请求。可以在 Runtime 创建前停止或使用本地受控假 Provider。

## 12. 真实 DeepSeek 验收

仅在用户明确授权真实请求和可能费用后执行。

使用临时配置、Session 和 Memory 目录。API Key 从当前受信任环境注入测试准备过程，再写入临时 config；不得打印临时 config 或保存真实回答正文。

场景：

1. 使用 `--profile` 启动 NDJSON；
2. `ready` 投影正确 provider/model；
3. 连续两轮回答成功；
4. 至少一次现有只读 Tool Loop 成功；
5. 退出后 Session 不含 Key；
6. 默认 Profile 再启动可恢复对应 Session；
7. stderr 和失败诊断无 Key；
8. 清理全部临时文件。

真实失败必须归类为 Config、Selection、Provider、Persistence、Protocol 或外部瞬时波动。不得通过输出配置、增加无界 retry 或降低断言定位问题。

## 13. 最终离线门禁

```text
npm run typecheck
npm test
npm run build
npm run pack:check
git diff --check
```

收口报告必须记录：

- 测试文件通过/跳过/失败数；
- 测试条目通过/跳过/失败数；
- P0/P1 未完成项；
- build 和 pack 结果；
- secret scan 结果；
- 是否运行真实验收；
- config 明文凭据限制；
- Windows/POSIX 权限差异；
- Git 状态；
- 明确声明未执行 Git add、commit 或 push。

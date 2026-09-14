# Isla v0.2.3 验证记录

日期：2026-09-12

## 离线门禁

- Batch A–H 专项测试通过；
- 全量测试：44 个测试文件通过，3 个跳过；158 条测试通过，3 条跳过；
- `npm run typecheck` 通过；
- `npm run build` 通过；
- `git diff --check` 通过；
- 默认测试未联网，未读取真实用户数据。

## 真实 Provider 验收

用户已明确授权后，使用项目 `.env` 加载修正后的真实 smoke 脚本，并先重新构建 `dist`。

- 命令：`npm run test:smoke:real:ndjson`；
- 结果：完整 NDJSON 场景连续两轮通过；
- 耗时：约 19 秒；
- 覆盖：普通回答、明确记忆、目录检查、只读讨论、项目文件能力、Approval 拒绝/批准、文件写入、`new_session`、正常退出；
- 未发现空 `response_end`、来源伪造或秘密泄漏。

## v0.2.3 专项真实项目检索

使用临时 workspace 写入唯一事实 `PROJECT-FACT.md`，通过真实 DeepSeek NDJSON 启动当前 `dist/cli.js`，明确要求只调用 `search_project`。

- 测试：`tests/smoke/real-project-search.test.ts`；
- 结果：通过；
- 耗时：约 2.2 秒；
- 已断言：出现 `search_project` 的 `tool_start`；出现 `search_project` 且 `ok=true` 的 `tool_end`；最终 `response_end` 包含可核验的相对路径或行号；
- 临时 workspace、Session 和 Memory 目录已清理；
- 该专项测试只收集事件并做断言，未启用 `ISLA_NDJSON_LOG`，因此没有对应原始日志文件。

## 脚本修复

真实 smoke 脚本此前未加载 `.env`，导致即使 `npm run dev` 能读取配置，测试仍将 Provider 判定为未配置。`test:smoke:real` 与 `test:smoke:real:ndjson` 现通过 Node `--env-file-if-exists=.env` 加载项目配置。

## Git 与隐私

未执行 Git add、commit 或 push。真实 API Key、`.env`、临时 Session、Memory SQLite 和真实日志未写入源码、测试或构建产物。

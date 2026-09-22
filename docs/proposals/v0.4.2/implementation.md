# v0.4.2 实施步骤

## Batch A：统一目录

建立纯投影服务，合并内建 Tool、Skill 与 MCP 状态；保持各自现有注册表为事实源。停点：排序、身份、脱敏和不可变性单测通过。

## Batch B：Profile 策略

扩展 parser，加入 Skill/MCP allow/deny；在能力进入模型请求前应用策略。停点：未配置 Profile 与 4.1 完全兼容。

## Batch C：预算与 Snapshot

增加预算计算、稳定 hash 和请求级 Snapshot；Journal 只记录安全摘要。停点：同一请求期间能力集合不漂移，超限不产生半目录。

## Batch D：Surface

实现 `/capabilities`、`check` 与 NDJSON `capabilities_list`，复用同一投影。停点：TTY/NDJSON 事实一致。

## Batch E：真实评估

组合至少一个内建 Tool、两个 Skill 和一个多工具 MCP Server，验证 allow/deny、预算、Approval 与重启边界；更新 README、roadmap 和验收记录。

每批完成后运行 typecheck、相关 Vitest、`git diff --check`；最终运行 `npm run verify` 与 `npm run pack:check`。

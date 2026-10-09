# v0.4.9 文档整合执行清单

本清单用于本次收口和后续 Luna 执行。当前工作区已完成 current 入口重建；本阶段只对明确安全的重复项做处理，保留有历史价值的 proposal 和 archive。

## 体积基线

| 范围 | 当前规模 | 说明 |
|---|---:|---|
| `docs/` | 约 1.1 MiB / 157 文件 | 主要是历史 archive 和逐版本 proposal |
| `docs/archive/` | 约 535 KiB / 49 文件 | 历史事实，不进入 npm 包 |
| `docs/proposals/v0.4.7/` | 约 102 KiB / 9 文件 | 当前最大的单版本 proposal，含设计、评估、研究和交接材料 |
| `docs/current/` | 约 26 KiB / 5 文件 | 当前权威入口 |
| npm tarball | 以 `npm pack --dry-run` 实测为准 | package 白名单不包含 `docs/` |

## 处理规则

### 保留

- `docs/current/` 五个权威入口；
- `docs/roadmap.md` 的精简版本历史和未来方向；
- 每个已完成版本至少一份入口和脱敏验收结论；
- 能解释核心架构决策、兼容迁移或安全边界的历史资料；
- `docs/archive/index.md` 和 v0.4.9 审计记录。

### 合并

- 已完成 proposal 的 `implementation.md` 与 `testing.md`：将稳定结论提炼到 `evaluation.md` 或 README，原文移入 archive；
- 版本内重复的 README、design、research、handoff：入口保留摘要，其余移入版本 archive 子目录；
- `docs/references.md` 与 `docs/dsh-reference-review.md`：保留一个外部参考索引，另一个只保留差异性取舍。

### 归档

- 已完成版本的详细实施批次、长测试矩阵和交接材料；
- `v0.4.7` 的真实评估方法、研究和 GitHub 对话记录；
- v0.2/v0.3 早期架构与实现历史。

### 删除候选（需要逐项确认）

- 已被脱敏 `evaluation.md` 完整替代的逐字 transcript；
- 只重复当前文档、没有独立决策或评估证据的交接文件；
- 明确生成、临时或空壳文件；
- 旧的本地真实日志（若仍位于 `docs/`，应先移到 `.isla-local/evaluations/`，不直接丢弃）。

删除前必须输出文件列表、替代入口、字节数和可恢复位置；没有用户确认不得执行不可逆删除。

## 建议执行顺序

1. 先生成每个候选文件的摘要、引用关系和体积；
2. 先合并 `v0.4.7`，再处理 v0.2/v0.3 proposal；
3. 更新 archive index 和所有相对链接；
4. 运行 Markdown 链接、脚本引用、秘密和原始日志扫描；
5. 统计 Git 文档体积与 npm tarball 体积；
6. 再进行真实对话评估；
7. 发现 Runtime 问题只记录复现和影响，不在文档整理阶段擅自改核心代码。

## 当前判断

通过 SHA-256 未发现完全重复 Markdown 文件。主要节省空间应来自“逐版本文档合并为摘要 + 详细资料归档”，而不是机械删除。npm 包体积与 docs 体积基本独立，需另行分析 `dist`、source map 和依赖。

## 本轮验证补充

- 初始文档审计时环境未配置真实 Provider 开关、模型名或 API Key；用户随后授权并完成了百炼真实评估。
- `npm run test:smoke` 仅跳过 6 个预置真实 smoke 文件；`npm run test:smoke:mcp` 因未配置 MCP Server 命令而跳过。另行执行的百炼专用评估已完成。
- 单独串行运行 `npm run verify` 通过：116 个测试文件通过、7 个跳过，476 项测试通过、11 项跳过，类型检查和构建通过。
- 并发启动多个 Vitest 任务时，Windows 子进程测试曾出现超时、临时目录锁和 `node-pty AttachConsole failed`；失败测试串行重跑全部通过。该问题应作为测试执行环境/并发门禁问题记录，不应误判为 Runtime 回归。

## qwen-plus-2025-07-28 真实评估结论

本轮使用本机 `bailian` Profile 和隔离临时 workspace/session，原始记录保存在 `.isla-local/evaluations/`，未进入 Git。Runtime/Tool 层面 10 项门禁全部通过：启动、Tool Calling、只读读取、拒绝 Approval、批准编辑、编辑后继续 Model Step、终态完整性均正常。

回答质量仍有两个需要后续处理的问题：

1. 多轮上下文回合没有准确复述上一轮要求，评估脚本当前仅按关键词计分，存在误报通过；
2. 代码生成回合无写文件需求，却错误触发 `edit_text_file` Approval，随后停止，未完成代码输出。

这两项暂不归因于 Runtime 核心故障，可能涉及模型工具选择、系统提示或评估脚本评分过宽；v0.5.0 应增加语义断言和“无工具需求不得发起写入 Tool”回归场景。

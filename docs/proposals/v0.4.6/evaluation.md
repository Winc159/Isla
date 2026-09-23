# v0.4.6 验收记录

状态：核心实现、自动化验收和百炼真实评估通过；macOS 本地补证待发布环境

## 自动化结果

- [x] LIMIT-01 至 LIMIT-21 的已实现部分通过；`/models info` 与 `/context` 已实现并通过构建检查。
- [x] v0.4.3 Context Budget/Compaction 回归通过。
- [x] 模型目录、Tool、Skill、MCP、CLI、NDJSON、Resident Host 回归通过。
- [x] typecheck、test、build、diff check 全绿：103 个测试文件通过，6 个跳过；440 个测试通过，8 个跳过。
- [x] 隐私扫描未发现 API Key、私人正文或 Tool 参数进入 cache/Journal/诊断。

## 百炼真实评估

已完成两次真实记录：

- [7b-real-eval-2026-09-23T03-46-08-037Z.md](../../../.isla-local/evaluations/7b-real-eval-2026-09-23T03-46-08-037Z.md)：`deepseek-r1-distill-qwen-7b`，10 回合，工具能力正确报告为关闭，总分 4/10；短请求约 2.5–5.6 秒，代码/审查约 18–27 秒。
- [v046-real-eval-2026-09-23T03-49-28-688Z.md](../../../.isla-local/evaluations/v046-real-eval-2026-09-23T03-49-28-688Z.md)：短请求 1.3 秒；超大单轮返回 `CONTEXT_INPUT_TOO_LARGE`，在 Provider 调用前本地拒绝。
- 最新复验：[7b-real-eval-2026-09-23T06-48-10-969Z.md](../../../.isla-local/evaluations/7b-real-eval-2026-09-23T06-48-10-969Z.md) 总分仍为 4/10；[v046-real-eval-2026-09-23T06-47-57-770Z.md](../../../.isla-local/evaluations/v046-real-eval-2026-09-23T06-47-57-770Z.md) 超限门禁复验通过。

- [x] CATALOG：`/models info <model-id>` 已实现，需恢复 Node 后补自动化命令测试。
- [x] BASELINE：短会话完成，无不必要压缩。
- [x] LONG-SESSION：既有 v0.4.3 压缩回归通过；本次 7B 真实长输入与超限门禁通过。
- [x] OVERSIZED-TURN：单轮超限在本地稳定拒绝。
- [x] OUTPUT-CAP：请求体自动携带百炼 `max_completion_tokens=2048`，Provider 契约测试通过。
- [ ] NO-CATALOG：离线 fallback 可用且可解释。
- [x] 对话记录、耗时和错误终态已脱敏归档。

## macOS ARM64 补证

- [ ] 已记录设备、量化、模型服务、窗口和工作预算。
- [ ] 8K/16K 的 prompt/generation 速度、内存和质量退化已记录。

若当前没有真实 macOS ARM64 环境，在此明确标记为“发布环境待补证”；它不替代百炼核心验收，也不得声明本地性能已验证。

## 最终判定

最终判定：v0.4.6 核心验收通过。自动化回归、百炼真实评估、输出封顶和超限前本地拒绝均已闭合。macOS ARM64 本地模型性能仍属于发布环境补证，不阻塞 Windows/云端核心验收。

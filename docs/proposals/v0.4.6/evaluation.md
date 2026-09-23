# v0.4.6 验收记录

状态：核心实现与自动化验收通过，真实评估已完成；待补模型目录诊断与 macOS 本地补证

## 自动化结果

- [x] LIMIT-01 至 LIMIT-21 的已实现部分通过；模型目录 info 与跨 Surface 预算诊断仍待后续 Batch E 完成。
- [ ] v0.4.3 Context Budget/Compaction 回归通过。
- [ ] 模型目录、Tool、Skill、MCP、CLI、NDJSON、Resident Host 回归通过。
- [x] typecheck、test、build、diff check 全绿：103 个测试文件通过，6 个跳过；440 个测试通过，8 个跳过。
- [ ] 隐私扫描未发现 API Key、私人正文或 Tool 参数进入 cache/Journal/诊断。

## 百炼真实评估

已完成两次真实记录：

- [7b-real-eval-2026-09-23T03-46-08-037Z.md](../../../.isla-local/evaluations/7b-real-eval-2026-09-23T03-46-08-037Z.md)：`deepseek-r1-distill-qwen-7b`，10 回合，工具能力正确报告为关闭，总分 4/10；短请求约 2.5–5.6 秒，代码/审查约 18–27 秒。
- [v046-real-eval-2026-09-23T03-49-28-688Z.md](../../../.isla-local/evaluations/v046-real-eval-2026-09-23T03-49-28-688Z.md)：短请求 1.3 秒；超大单轮返回 `CONTEXT_INPUT_TOO_LARGE`，在 Provider 调用前本地拒绝。

- [ ] CATALOG：模型限制和来源可核对。
- [x] BASELINE：短会话完成，无不必要压缩。
- [ ] LONG-SESSION：仍需专门构造跨轮 Token 压缩样本。
- [x] OVERSIZED-TURN：单轮超限在本地稳定拒绝。
- [x] OUTPUT-CAP：请求体自动携带百炼 `max_completion_tokens=2048`，Provider 契约测试通过。
- [ ] NO-CATALOG：离线 fallback 可用且可解释。
- [x] 对话记录、耗时和错误终态已脱敏归档。

## macOS ARM64 补证

- [ ] 已记录设备、量化、模型服务、窗口和工作预算。
- [ ] 8K/16K 的 prompt/generation 速度、内存和质量退化已记录。

若当前没有真实 macOS ARM64 环境，在此明确标记为“发布环境待补证”；它不替代百炼核心验收，也不得声明本地性能已验证。

## 最终判定

待实施和真实评估后填写。只有自动化、百炼真实评估和所有阻断项均闭合，才可声明 v0.4.6 核心验收通过；macOS 补证是否阻塞发布需在当时单独说明。

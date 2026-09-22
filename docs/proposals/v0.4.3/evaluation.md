# v0.4.3 验收记录

状态：核心实现、自动化验收和小型真实评估通过，已收口

## 当前结果

- [x] Provider-neutral 字符/回合预算测量已接入。
- [x] 既有 Tool 配对保护、自动 checkpoint 和旧 Session 兼容测试通过。
- [x] 新增 `/context` 只读预算状态入口。
- [x] 完整 `verify` 通过：98 个测试文件通过，6 个跳过；423 个测试通过，8 个跳过。
- [x] typecheck、build、`git diff --check` 通过。

## 小型真实评估

- [x] 9 条消息、3 个回合、约 2278 字符的长上下文在 500 字符预算下稳定报告 `needsCompaction=true`。
- [x] 投影保留最近 2 个完整回合，Tool Call/Result 不被拆开，原始 9 条消息未修改。
- [x] 官方 Filesystem MCP 真实启动与 4.2 能力投影通过：发现 14 个工具，deny 写工具后暴露 12 个，能力 hash 为 `8f9d9502`，目录不含工作区路径。
- [x] 审查修正 `/context` 使用默认预算的问题，现读取当前 Profile 的 `maxContextTurns/maxContextChars`。

## 收口边界

4.3 当前收口的是预算测量、已有压缩核心和诊断入口；后台压缩、跨 Session 压缩和删除原始历史仍明确不在范围内。真实长会话评估可在目标 MCP/Provider 环境中补充，不阻塞当前开发基线。

收口结论：4.3 核心契约已通过自动化和小型真实评估，进入后续版本前不再重开本版实现。

- [ ] 预算报告稳定。
- [ ] Tool Result pruning 安全。
- [ ] checkpoint 可验证且不删除原始事实。
- [ ] 自动压缩无循环。
- [ ] Session 恢复一致。
- [ ] 长会话真实评估通过。
- [ ] typecheck/test/build/pack/diff 全绿。

最终判定：未验收。

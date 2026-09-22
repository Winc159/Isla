# v0.4.3 测试设计

- CTX-01 预算估算确定且按路由配置。
- CTX-02 最近完整回合、system 和当前任务永不被拆散。
- CTX-03 Tool Call/Result 始终配对。
- CTX-04 大型可重取结果先于历史正文裁剪。
- CTX-05 写操作、审批拒绝和错误证据默认保留。
- CTX-06 checkpoint 只覆盖连续已关闭回合。
- CTX-07 摘要失败、取消、超时不写入。
- CTX-08 原始 Session 保留，可重新投影。
- CTX-09 旧 Session 无 checkpoint 时兼容。
- CTX-10 恢复后请求与压缩前有效投影一致。
- CTX-11 恶意 Tool 文本不能成为 system 指令。
- CTX-12 TTY/NDJSON 预算状态一致。

真实评估：连续多轮使用项目搜索与 Filesystem MCP，触发至少一次 pruning 和 checkpoint，后续回答仍引用正确项目事实。

阻断：丢失 Tool 配对、删除原始历史、压缩循环、摘要污染 system 或恢复不一致。

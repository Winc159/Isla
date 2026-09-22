# v0.4.4 验收记录

状态：核心实现与自动化/真实评估通过，已收口

## 当前结果

- [x] 模型暴露的 `run_command` schema 使用 `executable + argv`，direct spawn 不经过 Shell。
- [x] 旧 `command` 仅保留为内部兼容路径，未进入新 schema。
- [x] workspace cwd、超时、输出截断、取消、Approval 和 Windows 进程树清理已有回归覆盖。
- [x] 完整 `verify`：98 个测试文件通过，6 个跳过；425 个测试通过，8 个跳过。

## 真实评估

- [x] 隔离临时 workspace 中 direct argv 保留 `a;b` 参数边界，结果标记 `shell=direct`。
- [x] 同一隔离 workspace 中 100ms 超时可终止 10s Node 子进程，最终标记 `timedOut=true`，无残留进程观察。
- [x] `git diff --check`、typecheck、build 通过。

## 收口结论

v0.4.4 核心执行边界已完成并通过自动化与当前 Windows 环境真实评估。Linux/macOS 目标平台矩阵作为后续发布环境补证，不阻塞 v0.4.5 设计推进。

- [ ] argv 无 shell 执行通过。
- [ ] workspace 与 env 边界通过。
- [ ] Approval/拒绝通过。
- [ ] timeout/cancel/进程树清理通过。
- [ ] 当前平台真实评估通过。
- [ ] typecheck/test/build/pack/diff 全绿。

最终判定：未验收。

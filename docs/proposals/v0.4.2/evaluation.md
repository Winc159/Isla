# v0.4.2 验收记录

状态：核心实现与自动化验收通过，待收口

## 当前结果

- [x] 统一能力 inventory：builtin Tool、Skill、MCP Tool，稳定 id、来源和可见性。
- [x] Profile `capabilities` allow/deny 与 Tool/Skill 预算解析。
- [x] Session 创建时生成不可变能力投影，模型只收到允许的 Tool schema。
- [x] TTY `/capabilities` 与 NDJSON `capabilities_list` 提供只读诊断。
- [x] 定向能力、配置、协议测试通过；完整 `verify` 通过。

## 自动化证据

```text
完整 verify：97 个测试文件通过，6 个跳过；421 个测试通过，8 个跳过
typecheck/build：通过
git diff --check：通过
```

## 收口条件

- [x] CAP-01 至 CAP-13 的核心离线路径已覆盖。
- [x] 未引入通用插件、热重载、Subagent 或 Shell。
- [x] 下一步可进入 v0.4.3；真实多 Profile/大规模 MCP 目录评估作为后续补充证据。

## 功能门禁

- [ ] 三类能力统一投影。
- [ ] Profile allow/deny 生效且向后兼容。
- [ ] 预算与原子 generation 生效。
- [ ] 请求级 CapabilitySnapshot 可重建。
- [ ] TTY/NDJSON 事实一致。
- [ ] 真实 Filesystem MCP 组合评估通过。

## 自动化

```text
typecheck: 待执行
tests: 待执行
build: 待执行
pack: 待执行
diff-check: 待执行
```

最终判定：未验收。

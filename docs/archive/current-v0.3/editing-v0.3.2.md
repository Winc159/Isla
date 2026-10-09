# Isla v0.3.2：Safe Precise Editing

状态：已实现并完成离线门禁收口

日期：2026-09-16

## 1. 现实问题

Isla 已能列目录、搜索、读取和整文件写入，但修改已有文本只能使用 `write_text_file` 覆盖整个文件。小修改因此会产生大范围写入；模型读取后若文件被外部修改，还可能用旧内容覆盖新版本。

v0.3.2 只增加一个能力：安全、精确地编辑已经读取的 UTF-8 文本文件。

## 2. DSH 参考取舍

采用 DSH 文件工具已经验证的行为不变量：

- 编辑使用精确的旧文本与新文本，不由 Runtime 猜测行号或模糊修复；
- 默认要求旧文本唯一匹配，多处替换必须显式声明；
- 修改已有文件前必须成功读取，并拒绝基于陈旧内容写入；
- 修改结果原子替换目标文件；
- 成功编辑形成新的已观察版本，允许同一 Session 继续精确编辑。

不采用 DSH 的 Cordis、文件系统 Provider、事件瀑布、插件生命周期、通用版本服务或工具命名兼容层。

## 3. Tool 契约

新增模型可见 Tool：

```ts
edit_text_file({
  path: string,
  oldText: string,
  newText: string,
  replaceAll?: boolean,
})
```

行为：

1. `path` 必须是项目目录内的非敏感相对路径；
2. `oldText` 必须非空；
3. 目标文件必须在当前 Session 的文件能力实例中成功读取过，或由同一实例成功写入过；
4. 当前内容摘要必须与最后一次成功读取、写入或编辑后的摘要一致；
5. 默认恰好匹配一次；零匹配和多匹配稳定失败；
6. `replaceAll=true` 时替换全部非重叠匹配；
7. 写入同目录临时文件并保留原权限位，再替换目标；失败时清理临时文件；
8. 成功后更新观察摘要并返回路径与替换次数，不返回完整正文。

稳定错误码：

- `FILE_NOT_OBSERVED`
- `FILE_STALE`
- `EDIT_NO_MATCH`
- `EDIT_MULTIPLE_MATCHES`

文件不存在或普通 I/O 失败继续归一化为 `EXECUTION_FAILED`，沙箱拒绝继续使用 `SANDBOX_DENIED`。

## 4. 状态与安全边界

- 观察摘要只存在于当前 `createProjectFilesCapability()` 实例内，不写入 Session、Journal、日志或配置；
- 摘要基于完整 UTF-8 内容的 SHA-256，不保存第二份正文；
- `read_text_file`、`write_text_file` 和 `edit_text_file` 成功后更新同一观察状态；
- `edit_text_file` 使用现有 `filesystem-write` 权限、Approval、取消和 Tool 事件；
- 不增加新的 Isla 锁，不改变 config/session 锁；
- 不提供 Shell、Git、二进制编辑、补丁语言、正则替换或项目外路径。

## 5. 完成信号

- 精确单次替换和显式全部替换通过；
- 未读取、陈旧内容、零匹配、多匹配、沙箱越界和审批拒绝均稳定失败；
- 编辑成功后可继续编辑，外部修改后必须重新读取；
- 临时文件不会在成功或失败后残留；
- Tool Result 能驱动下一 Model Step；
- typecheck、离线测试、build、pack check 与 diff check 通过；
- 不运行真实 Provider 请求。

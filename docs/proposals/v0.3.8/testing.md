# Isla v0.3.8 PTY 测试计划

状态：已执行首批离线回归；Windows PTY 通过，macOS ARM64 与 Linux x64 标记为未验证。

## 1. Driver 自测

- `PTY-DRIVER-001`：子进程中 `process.stdin.isTTY` 和 `process.stdout.isTTY` 为 true；
- `PTY-DRIVER-002`：`enter()` 写入命令并接收回显；
- `PTY-DRIVER-003`：Ctrl+C 与 Esc 发送真实控制字节；
- `PTY-DRIVER-004`：`waitForText` 只匹配调用游标后的新输出；
- `PTY-DRIVER-005`：等待超时返回阶段、平台和限长脱敏输出；
- `PTY-DRIVER-006`：ANSI/CR 规范化保留普通中文与提示符；
- `PTY-DRIVER-007`：正常退出、异常退出和重复 `dispose()` 都不遗留进程；
- `PTY-DRIVER-008`：固定列宽下换行行为可重复。

## 2. 启动与退出

- `PTY-CLI-001`：真实 CLI 显示 header 与 `you> `；
- `PTY-CLI-002`：`/exit` 正常退出，exit code 为 0；
- `PTY-CLI-003`：空闲提示符按 Esc 正常退出；
- `PTY-CLI-004`：启动和退出不修改用户真实 Config、Session、memory 或 workspace；
- `PTY-CLI-005`：CLI 使用显式临时 Profile 与 workspace。

## 3. Skill 命令

- `PTY-SKILL-001`：`/skills` 显示 `fixture-review`；
- `PTY-SKILL-002`：`/skills fixture-review` 预览正文，不产生 Provider 请求、不创建 Turn；
- `PTY-SKILL-003`：`/skill fixture-review` 触发一个真实交互 Turn并输出固定回答；
- `PTY-SKILL-004`：`/skill fixture-review 请检查 fixture` 把 request 送入本地 fixture Provider；
- `PTY-SKILL-005`：调用期间出现 loading，完成后清除并恢复 `you> `；
- `PTY-SKILL-006`：未知或不可调用 Skill 显示稳定错误，终端仍可继续输入；
- `PTY-SKILL-007`：终端输出不泄露 API Key、Skill 绝对路径或内部 source。

正文是否进入模型、旧正文是否污染后续 Turn，继续由 v0.3.7.1 Session/Context 测试精确断言；PTY 只验证端到端用户行为。

## 4. `/new` 与 Session

- `PTY-SESSION-001`：普通 Turn 完成后 `/new` 清屏并恢复提示符；
- `PTY-SESSION-002`：`/new` 后的 Provider 请求不包含旧 Session 用户消息；
- `PTY-SESSION-003`：旧 Session 与新 Session 都持久化在临时 Session 目录；
- `PTY-SESSION-004`：`/new` 不继承上一 Session 的 Approval remember 状态；
- `PTY-SESSION-005`：退出后重新启动可按现有规则恢复最新临时 Session。

## 5. 取消

- `PTY-CANCEL-001`：Provider 延迟期间按 Ctrl+C 显示“正在取消本轮”；
- `PTY-CANCEL-002`：取消后不输出被取消请求的 assistant 最终回答；
- `PTY-CANCEL-003`：取消收敛后恢复 `you> `，下一条普通请求可以成功；
- `PTY-CANCEL-004`：取消后的 Session/Journal 状态与现有 cancelled 契约一致；
- `PTY-CANCEL-005`：取消收敛前第二次 Ctrl+C 以 130 退出，并完成父测试清理；
- `PTY-CANCEL-006`：空闲 Ctrl+C 按当前输入编辑器契约退出，不伪造 cancelled Turn。

不增加“生成期间 Esc 取消”测试；那不是当前契约。

## 6. Approval

- `PTY-APPROVAL-001`：写 Tool Call 显示工具、操作、权限和 `[y]/[n/Esc]/[a]`；
- `PTY-APPROVAL-002`：输入 `n` 后拒绝，临时目标文件不存在；
- `PTY-APPROVAL-003`：输入 Esc 后拒绝，临时目标文件不存在；
- `PTY-APPROVAL-004`：输入 `y` 后批准，只在临时 workspace 创建预期文件；
- `PTY-APPROVAL-005`：输入 `a` 后同一 Session 同类工具不再次询问；
- `PTY-APPROVAL-006`：Approval 完成后 raw mode 和普通输入提示符恢复；
- `PTY-APPROVAL-007`：Approval 等待期间 Ctrl+C 取消 Turn，不执行写操作；
- `PTY-APPROVAL-008`：终端 Approval 摘要不泄露 API Key 或 Skill 正文。

已补充并通过：批准写入文件、`a` 记住同类工具权限、记忆权限下连续 Tool Call 不重复询问。

Sandbox 越界和 read-before-edit 的精确错误仍以现有 Runtime 测试为主；可在 PTY 中各保留一个用户可见 smoke，但不能用 PTY 替代核心负向测试。

## 7. 输出与时序

- `PTY-OUTPUT-001`：spinner 回写不会吞掉最终回答；
- `PTY-OUTPUT-002`：最终回答只显示一次；
- `PTY-OUTPUT-003`：完成、失败和取消后 bracketed-paste/raw mode 都正确复位；
- `PTY-OUTPUT-004`：断言不依赖 spinner 帧、耗时秒数、临时端口或绝对路径；
- `PTY-OUTPUT-005`：中文、宽字符和固定列宽下提示符仍可识别；
- `PTY-OUTPUT-006`：测试连续运行三次无共享输出或旧游标误命中。

## 8. 隔离与安全

- `PTY-ISOLATION-001`：HTTP fixture 只监听 loopback；
- `PTY-ISOLATION-002`：测试 API Key 为固定假值，用户 Key 未被读取；
- `PTY-ISOLATION-003`：测试显式使用临时 Config/Profile；
- `PTY-ISOLATION-004`：真实 Provider 请求计数为零；
- `PTY-ISOLATION-005`：每个测试使用独立 workspace、Session 和 memory；
- `PTY-ISOLATION-006`：成功、失败和超时后端口、进程及临时目录均清理；
- `PTY-ISOLATION-007`：失败诊断脱敏路径、Key、Skill 正文和请求正文；
- `PTY-ISOLATION-008`：发布包不包含 PTY native addon 或 `tests/`。

## 9. 跨平台矩阵

以下组合必须使用同一测试入口：

| 平台 | 终端实现 | 必须状态 |
|---|---|---|
| Windows 10 1809+ / Windows 11 x64 | ConPTY | 通过 |
| macOS ARM64 | POSIX PTY | 未验证 |
| Linux x64 | POSIX PTY | 未验证 |

平台差异只允许封装在 Driver 的进程/信号适配中；测试场景和用户契约保持一致。任何未实际运行的平台标记为“未验证”，不得推断为通过。

## 10. 门禁命令

Luna 实施后应提供并执行：

```text
npm run typecheck
npm run test:pty
npm run test
npm run build
npm run pack:check
npm audit
git diff --check
git status --short
```

`test:pty` 必须全自动完成 build、fixture 启动、PTY 操作、断言和清理，不要求人工按键，也不访问真实 Provider。

## 11. 通过标准

- 已实施范围内的 Driver、CLI、Skill、Session、取消、Approval、输出和隔离用例通过；
- Windows 有实际通过记录；macOS ARM64、Linux x64 仍需 CI/实机记录；
- 连续运行无确定性泄漏或时序失败；
- 原有 NDJSON、CLI 单元测试和全量离线测试无回归；
- `pack:check` 证明 PTY 依赖不进入生产发布内容；
- package 版本仍为 `0.2.9`；
- 不产生 Git 写操作或真实 Provider 调用。

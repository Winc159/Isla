# Isla v0.3.8 PTY 测试驱动评估

状态：首批实现已完成。

## 1. 实施内容

- 新增 `node-pty 1.1.0` 开发依赖，并完成 Windows 原生构建；
- 新增真实 TTY 驱动：启动子进程、发送 Enter/Ctrl+C/Esc、读取输出、等待退出和资源清理；
- 新增 loopback OpenAI-compatible Provider fixture；
- 新增隔离 workspace、Config、Session、memory 和 Skill fixture；
- 新增 PTY driver 自测与 CLI PTY 回归；
- 新增 `test:pty` 脚本，执行构建后运行 PTY 测试；
- 未修改 Runtime 核心、Provider 生产实现或 CLI 交互契约。

## 2. 已执行结果

| 检查 | 结果 |
|---|---|
| `tsc -p tsconfig.json --noEmit` | 通过 |
| PTY 定向测试 | 10 passed |
| 全量 Vitest | 91 test files passed，5 skipped；398 passed，7 skipped |
| 构建 | 通过 |
| `pnpm pack --dry-run` | 通过；未包含 `tests/` 或 `node-pty` |
| `git diff --check` | 通过 |
| 真实 Provider | 未调用 |
| Git 写操作 | 未执行 |

## 3. PTY 场景结果

Windows 当前开发环境下通过：

- 真实 `stdin.isTTY` 子进程启动；
- `/skills` 列表；
- `/skills fixture-review` 预览且不触发 Provider；
- 普通用户问答并返回输入编辑器；
- `/new` 新建 Session 后继续对话；
- `/skill fixture-review <request>` 进入正常模型 Turn；
- 延迟请求期间 Ctrl+C 取消并恢复输入；
- 空闲输入期间 Esc 退出；
- `/exit` 正常退出；
- 临时目录、loopback 服务和子进程清理。

## 4. 实施中发现并修复的问题

1. Skill fixture 初始缺少 parser 要求的 frontmatter，导致目录为空；已补齐 `name`、`description`、`model-invocable` 和 `user-invocable`。
2. Windows ConPTY 子进程已退出后重复调用 `kill()` 会触发 console-list agent 噪声；Driver 现在记录退出状态，只对仍运行的进程执行 kill。

## 5. 风险与未完成项

- macOS ARM64、Linux x64 尚未在本轮实机或 CI 执行，不能标记为通过；
- Approval 拒绝、批准写入和 `a` 记忆同类工具权限的 PTY 场景均已加入并通过；跨 Session 的 remember 隔离由现有核心测试覆盖；
- `npm run test:pty` 在本机 shell 中无法直接执行是环境 PATH 问题：本机提供 Node/pnpm，但没有 npm 命令；通过等价的 Node/Vitest 命令完成了相同验证。

## 6. 结论

v0.3.8 的最小 PTY 测试闭环已经在 Windows 建立并通过离线回归：测试执行真实构建 CLI、真实 ConPTY、真实键盘控制字节和隔离本地 Provider。Approval 拒绝、批准和记忆权限也已完成首批覆盖。跨平台完成定义仍需 macOS ARM64 与 Linux x64 的实际运行记录。

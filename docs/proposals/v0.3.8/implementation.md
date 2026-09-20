# Isla v0.3.8 PTY 测试驱动实施顺序

状态：已实施；Windows 当前环境完成，其他目标平台待 CI/实机验证。

## 0. 实施前约束

1. 读取 `AGENTS.md`、`docs/architecture-v0.md`、本目录全部文档及现有 CLI/NDJSON 测试；
2. 检查工作区并记录基线，不覆盖无关改动；
3. 保持 package 版本 `0.2.9`；
4. 不执行 `git add`、`commit`、`push`；
5. 不读取或修改用户真实 Config/Profile、`.env`、Session、memory 或 Skill；
6. 不访问真实 Provider；
7. 每个 Batch 完成后运行对应门禁，失败先定位，不跳到下一批。

## 1. Batch A：依赖可行性尖峰

目标：只证明当前 Node 24 环境可以安装和启动真实 PTY，不接入 Isla 场景。

步骤：

1. 将 `node-pty` 加为 devDependency，让 lockfile 固定实际版本；
2. 在临时测试中用 `process.execPath -e` 启动子进程；
3. 子进程打印 `process.stdin.isTTY`，断言为 true；
4. 验证写入文本、接收输出和正常退出；
5. 在当前 Windows 环境先运行；CI 可用时再验证 macOS ARM64 与 Linux x64。

停点：

- 若安装需要本机缺少的构建工具，报告精确错误和官方安装前置条件，不切换到非官方 fork；
- 若 Node 24 ABI 不兼容，先查询 `node-pty` 官方版本/issue，再提交依赖选择复核；
- 尖峰通过后删除一次性代码，进入正式驱动。

## 2. Batch B：通用 PTY Driver

新增 `tests/support/pty-driver.ts` 及其测试。

步骤：

1. 封装 spawn、onData、onExit、write、resize 和 kill；
2. 实现 `enter`、Ctrl+C、Esc；
3. 实现带输出游标和超时的 `waitForText`；
4. 实现 raw/text 双缓冲和最小 ANSI/CR 规范化；
5. 实现幂等 `dispose` 与超时后的强制清理；
6. 限制失败诊断长度并脱敏临时路径；
7. 增加驱动自测：TTY=true、命令回显、控制键、超时、退出、重复 dispose。

停点：驱动测试在本机稳定重复运行，不涉及 Isla Provider。

## 3. Batch C：隔离 Fixture 与本地 Provider

新增 `tests/support/pty-fixture.ts`、`tests/support/openai-fixture-server.ts`。

步骤：

1. 创建每测试独立的临时 workspace、Config、Session 和 memory 路径；
2. 写入最小可调用 `fixture-review` Skill；
3. 启动 loopback 随机端口的本地 OpenAI-compatible 服务；
4. 支持固定回答、延迟回答、Tool Call/Tool Result 三类脚本；
5. 通过显式 `--config` 与 `--profile` 启动构建后的 CLI；
6. 清除可能改变 Provider、Session、memory 和 workspace 的 Isla 环境变量；
7. 验证服务收到的请求来自临时 Profile，且真实外网请求为零；
8. 验证 teardown 即使在断言失败时也关闭服务和临时进程。

停点：CLI 在 PTY 中显示 header 和 `you> `，输入普通请求后得到固定回答并可 `/exit`。

## 4. Batch D：首批命令回归

新增 `tests/pty/cli-pty.test.ts`，按 `testing.md` 分组实施。

建议顺序：

1. `/exit` 与空闲 Esc；
2. `/skills` 列表与预览无 Provider 请求；
3. `/skill fixture-review <request>` 返回固定回答；
4. `/new` 清屏、生成新 Session 且不带旧上下文；
5. 延迟 Provider 中 Ctrl+C 取消，随后仍可执行下一条命令；
6. Approval 使用 `n`/Esc 拒绝，文件保持不存在；
7. Approval 使用 `y` 批准，只在临时 workspace 写入 fixture 文件；
8. 强制退出和异常路径的清理。

每加入一个场景立即运行该文件，不一次堆完全部测试。

停点：所有首批场景连续运行至少三次无偶发失败。这里的三次用于发现时序问题，不替代三平台 CI。

## 5. Batch E：脚本与 CI 接入

步骤：

1. 增加独立脚本，例如 `test:pty`，明确先 build 再运行 PTY 测试；
2. 保持普通 `test` 是否包含 PTY 由实际耗时决定：若首批测试可稳定快速运行，则纳入 `check`；否则 `check` 必须显式串联 `test:pty`，不能成为人工可选项；
3. CI 使用 Windows、macOS ARM64、Linux x64 矩阵；若现有 CI 暂无 ARM64 runner，文档必须标记该平台尚未完成，不能用 x64 代替；
4. 单 worker 或串行配置只作用于 PTY 测试，不降低全套测试并行度；
5. 缓存不得复用不同 Node ABI 或 OS 的 native addon；
6. 记录各平台所需的原生构建前置条件。

停点：同一 `npm run test:pty` 在目标平台执行，不依赖人工键盘输入。

## 6. Batch F：完整门禁

依次执行：

1. `npm run typecheck`；
2. PTY driver 与 fixture 定向测试；
3. `npm run test:pty`；
4. `npm run test`；
5. `npm run build`；
6. `npm run pack:check`，确认 `node-pty` 和测试文件不进入发布包；
7. `npm audit`；
8. `git diff --check`；
9. `git status --short`。

如果现有全量测试出现时序型失败，先单测复现并记录；不能仅靠提高全局 timeout 或无界 retry 掩盖失败。

## 7. 允许修改范围

预期新增或修改：

```text
package.json
package-lock.json
tests/support/pty-driver.ts
tests/support/pty-driver.test.ts
tests/support/pty-fixture.ts
tests/support/openai-fixture-server.ts
tests/pty/cli-pty.test.ts
vitest.config.ts 或 PTY 专用 Vitest 配置
docs/proposals/v0.3.8/*
```

只有 PTY 测试先稳定复现真实 CLI 缺陷时，才允许最小修改 `src/cli*` 或 `src/approval/cli-approval.ts`。不得借机重构 Runtime。

## 8. Luna 交付格式

完成后报告：

- 实际安装的 `node-pty` 版本和目标平台；
- 新增测试 ID 与结果；
- 三平台状态，未验证的平台必须明确标记；
- 是否发现 CLI adapter 缺陷及最小修复；
- 全量门禁结果；
- package 版本保持情况；
- `git status --short` 摘要；
- 未执行 Git 写操作与真实 Provider 调用的确认。

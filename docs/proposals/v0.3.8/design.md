# Isla v0.3.8 PTY 测试驱动设计

状态：已实施；本文记录已采用的设计与边界。

## 1. 问题

现有 CLI 测试通过伪造 `isTTY` 的内存流验证编辑器和命令处理，NDJSON E2E 通过普通管道验证结构化协议。它们都不会创建操作系统级伪终端，因此不能证明以下行为在真实终端成立：

- Node.js 是否把输入识别为 TTY；
- raw mode、readline keypress 和 ANSI 控制序列是否协同工作；
- Ctrl+C 是否作为终端信号取消当前 Turn；
- Approval 的单键输入是否正确切换 raw mode；
- 一轮完成或取消后，输入提示符能否恢复；
- 退出后是否遗留子进程或终端状态。

v0.3.8 补齐这一层，不替代现有单元测试或 NDJSON 测试。

## 2. 测试边界

三层测试各自负责：

```text
单元测试：函数、内存流、稳定错误和状态机
NDJSON：机器协议、事件顺序和结构化请求
PTY：真实终端、按键、提示符、ANSI、信号和进程退出
```

PTY 测试只断言用户可观察的交互结果和必要的持久化结果，不重复断言 Agent Loop 内部每一个事件。

## 3. 技术选择

采用 `node-pty` 作为开发依赖。它直接提供 Linux/macOS PTY 和 Windows ConPTY，API 能启动子进程、写入按键、读取终端数据、调整尺寸和终止进程。官方说明其支持 Linux、macOS 与 Windows，Windows 使用 ConPTY；同时它是原生模块，安装可能需要对应平台的编译工具：

- <https://github.com/microsoft/node-pty#readme>
- <https://github.com/microsoft/node-pty/blob/main/typings/node-pty.d.ts>

采用理由：

- 一个 Node.js API 覆盖目标三平台；
- Windows 使用真实 ConPTY，不通过 PowerShell 管道冒充终端；
- 与 Vitest 和现有 TypeScript 测试结构可直接组合；
- 依赖只存在于开发与测试环境。

不采用：

- 普通 `child_process.spawn(..., stdio: pipe)`：`stdin.isTTY` 不成立；
- 用内存流手工添加 `isTTY=true`：保留为快速单元测试，但不算真实 PTY；
- shell 脚本分别调用 `script`、`expect` 或平台专用工具：跨平台语义和安装要求不一致；
- 预编译第三方 fork：先使用维护方原包，只有 `node-pty` 在 Node 24 目标矩阵确实无法安装时才重新评估。

实施时由 `package-lock.json` 锁定实际安装版本，不在文档中预写未经本项目三平台验证的版本号。

## 4. 驱动结构

建议新增：

```text
tests/
  pty/
    cli-pty.test.ts
  support/
    pty-driver.ts
    pty-fixture.ts
    openai-fixture-server.ts
```

`pty-driver.ts` 提供窄接口：

```ts
interface PtyDriver {
  readonly rawOutput: string;
  readonly textOutput: string;
  write(text: string): void;
  enter(command: string): void;
  sendCtrlC(): void;
  sendEscape(): void;
  waitForText(text: string, options?: WaitOptions): Promise<void>;
  waitForExit(options?: WaitOptions): Promise<{ exitCode: number; signal?: number }>;
  dispose(): Promise<void>;
}
```

约束：

- 驱动直接启动 `process.execPath`，参数指向绝对路径 `dist/cli.js`；不经过 shell；
- 固定终端尺寸，例如 100x30，避免换行随宿主终端变化；
- `enter()` 使用 `\r`，控制键使用真实控制字节；
- 每次等待必须有超时，并从本次操作的输出游标开始匹配，不能误命中旧输出；
- 同时保留原始输出和规范化文本；断言优先使用规范化文本；
- `dispose()` 幂等，先请求正常退出，再在限时后终止子进程；
- `afterEach` 无条件关闭 PTY、HTTP 服务并清理临时资源；
- 测试串行运行，避免多个交互进程争用时序和污染诊断。

## 5. 输出规范化

终端输出包含光标移动、清行、spinner 回写和 bracketed-paste 控制序列。测试不能对完整字节流做快照。

规范化只用于断言和失败诊断：

1. 保留 `rawOutput`，但不默认打印；
2. 将 CR 回写按终端行语义折叠；
3. 移除已知 ANSI/CSI 控制序列；
4. 统一换行；
5. 不修改普通 Unicode 文本；
6. 不把连续空白全部压平，以免掩盖提示符布局错误。

spinner 帧、耗时秒数和临时绝对路径属于不稳定内容，只断言稳定锚点，例如 `you> `、`isla> ready`、`正在取消本轮` 和 Approval 提示。

## 6. 离线 Provider fixture

PTY 子进程必须执行真实 CLI 入口，但不能依赖真实账户。测试父进程启动仅监听 loopback 随机端口的本地 HTTP 服务，模拟 Isla 已支持的 OpenAI-compatible 接口；临时 Config/Profile 指向该地址。

服务按测试场景返回确定响应：

- 普通回答：返回固定 `ready`；
- 延迟回答：保持请求挂起，直到 Abort 或测试释放；
- Approval：先返回固定 `write_text_file` Tool Call，再在 Tool Result 后返回完成回答；
- `/new`：记录请求的消息摘要，供测试确认新 Session 没有旧用户消息。

安全边界：

- 只绑定 `127.0.0.1` 或 `::1`，使用系统分配端口；
- 使用明显的测试 API Key，不读取用户环境中的 Key；
- 子进程使用显式临时 Config/Profile、workspace、Session 和 memory 路径；
- 清除会影响配置选择的 Isla 环境变量，只传递运行所需的环境；
- fixture 只记录角色、Tool 名和测试标记，不记录 Skill 正文或完整私人内容；
- 不在生产代码注册 fake Provider，不增加 `--test` 等隐藏入口。

如果现有 OpenAI-compatible Provider 无法由临时配置指向 loopback，Luna 必须先报告该事实并停在设计复核点，不能为测试向 Runtime 增加后门。

## 7. Fixture 工作区

每个测试创建独立临时目录，至少包含：

```text
workspace/
  .isla/skills/fixture-review/SKILL.md
config/config.json
sessions/
memory/
```

`fixture-review` 仅要求返回固定短文本，不含真实路径、秘密或私人请求。Approval 场景只允许在临时 workspace 内创建固定文件，并在测试结束后删除整个 fixture。

## 8. 当前交互契约

v0.3.8 固化当前代码已经表达的语义：

- 生成期间第一次 Ctrl+C：取消当前 Turn并显示“正在取消本轮”；
- 取消收敛前第二次 Ctrl+C：允许进程以 130 强制退出；
- 空闲输入期间 Ctrl+C 或 Esc：退出输入循环；
- Approval 期间 `y` 批准，`n`、Enter 或 Esc 拒绝，`a` 记住当前工具权限；
- `/exit` 正常退出；
- `/new` 创建隔离 Session。

“生成期间 Esc 取消”不是当前契约，本版不新增。如果 PTY 测试发现实际行为与上述契约冲突，应先记录为失败并回到设计确认，不顺手改变交互语义。

## 9. 可靠性与诊断

- 每个动作采用明确阶段超时，不使用固定长时间 `sleep`；
- 可以用极短轮询实现 `waitForText`，但成功条件必须来自输出或进程退出；
- 超时时报告：场景名、平台、Node 版本、当前阶段、退出状态和限长规范化尾部；
- 只有显式 debug 开关才保存限长原始终端轨迹；
- 诊断必须脱敏临时根目录、API Key、Skill 正文和请求正文；
- 测试失败也必须执行清理；清理失败作为附加错误报告，不能覆盖原始断言错误；
- Windows ConPTY、macOS PTY 和 Linux PTY 都由 CI 矩阵验证，不能以单平台通过宣称跨平台完成。

## 10. Runtime 边界

PTY 驱动是测试基础设施，不进入：

- `src/core`、Agent Loop 或 Session 投影；
- Approval、Sandbox、取消的核心实现；
- Config/Profile 的事实源规则；
- npm 发布包的生产依赖。

若真实 PTY 暴露 CLI adapter 缺陷，只允许最小修改 CLI 适配层，并为该缺陷增加先失败后通过的回归用例。任何核心契约变化必须停止实施并另行确认。

## 11. 完成条件

1. `node-pty` 仅为 devDependency；
2. 测试启动真实 `dist/cli.js` 且确认交互提示出现；
3. 首批测试矩阵通过；
4. 无真实网络、真实凭据或用户 Config 依赖；
5. 无测试专用生产入口；
6. 所有进程、端口、临时文件和 raw mode 正常清理；
7. Windows、macOS ARM64、Linux x64 均通过；
8. 全量离线门禁通过。

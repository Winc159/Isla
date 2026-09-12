# Isla v0.2.5 评估与收口

## 范围

本版完成启动 Profile、本地配置、首次向导、Profile 选择、配置管理命令、人格与日志设置，以及无 TTY 的 CLI/NDJSON 启动路径。`StoredSession.messages`、Tool、Approval、Memory 和现有项目检索语义保持不变。

取消、受控联网、Shell、会话内模型热切换、OpenAI/Local Tool Calling 对齐和子 Agent 不属于本版交付范围。

## 批次状态

- Batch A：Profile schema、解析和默认值；完成。
- Batch B：ConfigStore、原子写入、revision 冲突和权限尽力保护；完成。
- Batch C：启动参数、Profile/env 选择和失败边界；完成。
- Batch D：首次设置向导；完成。
- Batch E：`/config` 管理命令；完成。
- Batch F：`/profile` 管理命令；完成。
- Batch G：personality、日志级别和运行时投影；完成。
- Batch H：README、env 兼容、协议回归和打包边界；完成。
- Batch I：机器可编排规则、自动化案例和收口文档；完成。

## 验证结果

最终离线门禁：

- 52 个测试文件通过，4 个测试文件跳过；
- 204 条测试通过，4 条测试跳过；
- `npm run typecheck` 通过；
- `npm run build` 通过；
- `npm run pack:check` 通过；
- `git diff --check` 通过（仅保留既有 CRLF 提示）。

机器可编排路径由配置选择测试、协议 e2e 和安全扫描覆盖：自动化调用方可以生成临时 config、显式选择 Profile 或 `--env`、启动 NDJSON、完成多轮对话并读取终态，不依赖 TTY 菜单或人工打开配置文件。API Key 不通过命令行参数，不进入 stdout、stderr、Session、Memory、Journal、Tool 内容或打包产物。

## 已知限制

- v0.2.5 配置文件中的 API Key 为本地明文，文档和运行时均明确提示；后续可评估系统密钥环，但不在本版引入。
- Windows 上的 `chmod` 不能等同 ACL；实现只做尽力保护，不作过强安全声明。
- `/profile use`、人格和日志设置均在下次启动生效；本版不提供会话内热切换。
- OpenAI、Local Provider 及其 Tool Calling 尚未进行真实网络验收；默认测试仍完全离线。
- 真实 DeepSeek Profile 启动不在本次自动执行，需用户明确授权后使用临时目录验收。

## 收口结论

v0.2.5 离线实现和文档门禁完成，可以进入历史收口状态。未执行 `git add`、`git commit` 或 `git push`。未来任何新增能力都必须保留由单一 Agent 通过 CLI/NDJSON/API 完成配置、执行、确认、取消（如适用）和结果验证的无 TTY 路径；没有该路径及对应自动化验收的功能不得宣称完成。

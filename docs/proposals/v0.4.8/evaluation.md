# v0.4.8 验收记录

状态：实现收口，验收通过；发布前需在带 npm CLI 的环境补跑 `pack:check`

验收日期：2026-09-29

## 1. 功能门禁

- [x] Host-owned Capability Catalog 已建立。
- [x] 内置、Browser、Web、Context、Skill 与 MCP 有稳定 Capability ID。
- [x] Profile、Provider、平台、配置和预算过滤确定性生效。
- [x] Task Activation State 可持久化、恢复和重新验证。
- [x] Runtime 可在第一 Model Step 预选相关能力。
- [x] 模型可通过 search → activate 在下一 Step 获得能力。
- [x] 每 Model Step 使用独立不可变 Snapshot。
- [x] 请求 Tool Schema 与 Snapshot 完全一致。
- [x] 激活不重置 Loop Budget、失败计数或 Completion Gate。
- [x] MCP Tool Schema 按需暴露。
- [x] Journal、TTY 与 NDJSON 可解释选择和拒绝原因。

## 2. 安全门禁

- [x] Capability 搜索不返回秘密、完整 Schema、cwd 或命令参数。
- [x] 搜索结果不等于激活许可。
- [x] 激活不等于 Tool Approval。
- [x] 网页、MCP 结果、Skill 和模型文字不能修改策略。
- [x] 模型不能安装、下载或加载任意插件代码。
- [x] Profile deny、Sandbox 与用户 Approval 无绕过。
- [x] Snapshot、Journal 与诊断不含 secret。

## 3. 成本与质量证据

| 场景 | Catalog Tool 数 | 实际注入 Tool 数 | Schema bytes | 估算 Schema tokens | 成功 | 备注 |
|---|---:|---:|---:|---:|---|---|
| 简单问答 | 133 | 0 | 2 | 1 | 是 | 不注入业务工具 |
| 项目读取 | 133 | 1 | 133 | 34 | 是 | 只注入项目读取工具 |
| Browser fixture | 133 | 1 | 129 | 33 | 是 | search → activate → 下一 Step |
| MCP 策略拒绝 | 133 | 0 | 2 | 1 | 是 | 可发现但不能绕过 deny |
| 128 Tool MCP Catalog | 133 | 0 | 2 | 1 | 是 | 普通问题不注入 MCP Schema |

完成判据：简单问答和单域任务不再携带无关业务 Tool Schema；动态发现任务仍能在 Agent Loop 预算内完成。仅减少 token 但显著降低成功率，不得判定通过。

## 4. 自动化证据

```text
typecheck: 通过
tests: 476 passed, 11 skipped；首次并行运行 2 项受 Windows node-pty AttachConsole 干扰超时，隔离复测 14/14 通过
build: 通过
verify: 通过（内部 typecheck、476 tests、build）
pack:check: 当前运行时缺少 npm CLI，发布前补跑
diff-check: 通过，仅有 Git 的 LF/CRLF 提示
```

## 5. 真实评估

本轮已完成本地确定性对话评估，脱敏后的验收记录见 [`real-evaluation-transcript.md`](real-evaluation-transcript.md)。该记录由版本收口阶段的一次性本地脚本生成；脚本不属于产品维护入口，不进入仓库。评估不调用外部 Provider、不使用真实账号或秘密，覆盖 6 个场景：简单问答、项目文件、Browser 发现与激活、MCP 策略拒绝、网页 Prompt Injection、大型 MCP Catalog。

云端评估使用本地一次性脚本执行，脚本保存在被 Git 忽略的 `.isla-local/evaluation-scripts/`，原始日志写入 `.isla-local/evaluations/v0.4.8/`；两者都不进入文档目录、仓库或发布产物，需要长期保留的结论必须脱敏后人工整理到本文档。该评估只使用自然用户表达，每轮只描述目标，不得点名工具；评估脚本必须启用 Memory、按 Profile 的真实能力安排场景，并对 Browser、联网检索、审批和回忆分别判定。任何工具失败、未实际联网、错误回忆或未经证据的声称都应保留在本地日志中并判为失败。

2026-09-29 首轮云端自然场景发现并进入修复：Windows 下 Playwright bundled headless shell 被策略以 `spawn EPERM` 拒绝，Runtime 改为优先使用显式配置或已安装的 Chrome/Edge；评估脚本此前错误关闭 Memory，现已启用；最小上下文回退此前会无条件丢弃已检索的 Memory，现改为预算允许时保留；Bailian Profile 没有 Web Search 时不得把模型常识回答计为联网成功。

项目发现评估还发现生成的 `real-cloud-*` 对话日志会反向污染后续源码/文档搜索，使模型优先读到旧失败回答而非设计文档。原始日志现统一保存在 `.isla-local/evaluations/`，并增加防御性忽略规则；日志仍可由用户在本机直接打开，但不作为项目事实来源。

云端复测确认：仅依靠 Capability instructions 不能阻止部分模型在“查找公开资料”场景中跳过工具并直接生成结论。Agent Loop 因此增加外部研究完成门禁：没有成功的 Web Search、Web Fetch 或 Browser 读取证据时不能完成研究型回答；无可用来源发现能力时必须明确阻塞。

后续复测中门禁成功阻止了直接生成结论，模型转而调用 `web_fetch`；首个猜测来源返回 HTTP 404，随后云端回合超过评估时限。HTTP 非 2xx 响应现不再计为外部证据。该项已从“无依据完成”收紧为“无有效证据不得完成”，但 Bailian Profile 缺少 Web Search 时的来源发现成功率仍是剩余限制。

- [x] 简单问答零业务 Capability。
- [x] 项目问题只激活 Project。
- [x] 网页任务激活 Browser 且不激活 Shell。
- [x] MCP 能力可中途发现；可用能力激活后在下一 Step 生效，策略拒绝保持不可激活。
- [x] 恶意网页不能诱导激活高风险能力。
- [x] Context compaction 后继续使用正确 Snapshot。
- [x] 不支持 Tool Calling 的模型显示准确能力状态。

## 6. 已知暂缓

- MCP Server 进程按任务懒启动与自动卸载。
- 第三方本地插件 Manifest 与签名/信任管理。
- Capability 热更新。
- Embedding 或独立 LLM Router。
- MCP 动态 Tool Search 草案。
- 外部 Web Search Provider；当前联网研究优先使用 Browser，缺少有效外部证据时不得完成研究型回答。
- 跨设备同步和在线插件市场。

## 7. 最终判定

v0.4.8 实现与工程门禁验收通过，可以结束功能开发并进入发布准备。当前明确剩余项只有：在带 npm CLI 的发布环境执行 `npm run pack:check`；Bailian Profile 的外部资料发现继续采用 Browser，外部 Search Provider 暂缓。真实云端评估中的代理波动和来源发现超时不作为 Capability Catalog 核心发布阻断，但无证据完成门禁必须保留。

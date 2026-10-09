# v0.4.9 文档与源码审计

## 分类规则

| 标记 | 含义 |
|---|---|
| 当前事实 | 与当前源码一致，可作为使用或维护入口 |
| 历史提案 | 记录版本设计过程，不替代 current |
| 历史记录 | 已被替代但保留复盘价值 |
| 评估证据 | 允许公开的脱敏验收结论 |
| 重复内容 | 与权威入口重复，应改为导航或归档 |
| 已失效内容 | 描述已被当前实现替代 |
| 待确认内容 | 需要真实环境或后续版本验证 |

## 文档清单

| 路径 | 分类 | 处理 |
|---|---|---|
| `README.md` | 当前事实、导航 | 保留安装与使用，补充 current/roadmap/proposal 导航 |
| `docs/current/README.md` | 已失效 → 当前事实 | 从 v0.3.x 索引重写为当前入口 |
| `docs/current/architecture.md` | 已失效 → 当前事实 | 从 Bailian v0.3.0 专题重写为 v0.4.8 Runtime 架构 |
| `docs/current/implementation.md` | 已失效 → 当前事实 | 从历史 Batch 计划改为源码导航 |
| `docs/current/testing.md` | 已失效 → 当前事实 | 从 Bailian 专项矩阵改为当前测试分层与门禁 |
| `docs/current/decisions.md` | 已失效 → 当前事实 | 重写为稳定架构决策记录 |
| 原 `docs/current/*-v0.3*.md` 与原 `evaluation.md` | 历史记录、重复内容 | 移至 `docs/archive/current-v0.3/`，不删除 |
| `docs/proposals/v0.2.8/` 至 `v0.4.8/` | 历史提案 | 保留版本设计过程；完成事实由 current 汇总 |
| `docs/proposals/v0.3.6/` 至 `v0.4.8/` 中的 evaluation | 评估证据、历史记录 | 保留脱敏判定，不作为当前架构源 |
| `docs/archive/` | 历史记录 | 保留；由 archive index 导航，不回迁到 current |
| `docs/evaluations/v0.2.7.4/summary.md` | 评估证据 | 保留脱敏摘要 |
| `docs/roadmap.md` | 当前事实、历史记录 | 保留版本脉络，新增 v0.4.9 收口节点并修正过时状态 |
| `docs/bugs.md` | 当前事实模板 | 保留，当前无具体开放 Bug 条目 |
| `docs/references.md`、`docs/dsh-reference-review.md` | 历史参考 | 保留；外部观察不构成 Isla 架构事实 |
| `docs/evaluation-national-day.profile.example.json` | 历史评估示例 | 保留示例，禁止填入真实凭据 |
| `docs/proposals/v0.4.8/real-evaluation-transcript.md` | 评估证据 | 内容为脱敏场景摘要而非原始云端日志，保留但名称容易误解 |
| `.isla-local/evaluations/` | 本地原始评估 | Git 忽略，不进入仓库 |
| `.isla-local/evaluation-scripts/` | 本地专项工具 | Git 忽略，不进入正式 scripts |

## 源码与自动化清单

| 范围 | 当前事实 |
|---|---|
| `src/application.ts`、`src/main.ts`、`src/session-factory.ts` | Application、配置、Provider、MCP、Session 和能力装配边界 |
| `src/core/` | Session、Agent Loop、Context、Journal、Token、完成门禁和终态 |
| `src/capability-*.ts`、`src/capabilities.ts` | Host-owned Catalog、路由、激活与 Snapshot |
| `src/providers/`、`src/models/` | Provider 协议适配与模型目录 |
| `src/tools/` | 内建 Tool、组合、执行和结果契约 |
| `src/mcp/`、`src/browser/`、`src/memory/` | 外部能力、人工控制和持久记忆边界 |
| `src/protocol/`、`src/host.ts` | NDJSON 与 loopback Resident Host Surface |
| `src/sandbox/`、`src/approval/`、`src/user-questions/` | 路径、权限和人在回路边界 |
| `tests/` | 单元、集成、协议、Browser、MCP、PTY 和显式真实 smoke |
| `scripts/` | 仅保留 clean、browser 安装、MCP eval 与统一 verify |
| `.github/workflows/ci.yml` | Node 24 的 Ubuntu/Windows/macOS check、build 与 pack 检查 |
| `package.json` | npm scripts、依赖、Node 版本与发布白名单 |

## 发现的差异

1. `docs/current/` 核心入口停留在 v0.3.0-v0.3.5，而代码已到 v0.4.8；已重写。
2. current 混入多个带版本号的实现完成记录；已归档，current 只保留跨版本有效事实。
3. Roadmap 中 v0.4.6 和 v0.4.7 标题仍写“设计完成”，但对应核心源码和测试已经存在；调整为实现状态说明，同时保留 proposal 作为历史。
4. README 有丰富使用说明但缺少权威架构和开发导航；已补入口，不把全部架构复制进 README。
5. 正式 `scripts/` 与 `package.json.files` 已符合收口要求；未发现需要改 Runtime 的矛盾。

## 待确认

- Linux x64 与 macOS ARM64 的安装、PTY、Browser Console 和进程托管仍需对应目标机证据。
- 真实 Provider 只在显式授权环境执行；本次已完成百炼 `qwen-plus-2025-07-28` 隔离评估，第三方 MCP、网页任务和目标平台验收仍待后续授权与环境。
- `real-evaluation-transcript.md` 实际是脱敏摘要；后续可在不破坏历史链接的前提下改名为 summary。

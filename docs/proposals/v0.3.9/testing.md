# Isla v0.3.9 测试与收口门禁

状态：核心离线门禁已执行；Windows PTY 和真实 Provider 按环境条件单独记录。

## P0：文档与契约一致性

- `CLOSE-CONTRACT-001`：current 文档入口、roadmap、README、package version 和实现范围没有互相矛盾的当前版本声明；
- `CLOSE-CONTRACT-002`：CLI、NDJSON、PTY 的命令/事件/错误/退出语义有对照表；
- `CLOSE-CONTRACT-003`：Session、Journal、Message source、Profile 和 Protocol schema 的版本边界有测试或迁移说明；
- `CLOSE-CONTRACT-004`：Provider capability 报告与实际模型路由、streaming 回退和 Tool Loop 一致；
- `CLOSE-CONTRACT-005`：所有 stable/experimental/deferred/rejected 声明均有源码、测试或决策记录依据。

## P0：核心回归

- `CLOSE-CORE-001`：普通 prompt、多轮、`/new`、Session 恢复和 workspace 隔离；
- `CLOSE-CORE-002`：Tool schema、Tool Result、Approval y/n/Esc/a、Sandbox、read-before-edit 和验证完成门禁；
- `CLOSE-CORE-003`：Provider 失败、timeout、retry、取消、quiescence、BUSY 和唯一终态；
- `CLOSE-CORE-004`：Skill Tool、`/skills` 预览、`/skill` 当轮注入和后续 Turn 不污染；
- `CLOSE-CORE-005`：Memory、Project Search、Web、命令执行和模型 Tool 的现有测试无回归。

## P0：入口与平台

- `CLOSE-SURFACE-001`：TTY CLI subprocess 基础命令和错误路径；
- `CLOSE-SURFACE-002`：NDJSON prompt/skill/approval/cancel/new/session 生命周期和敏感字段过滤；
- `CLOSE-SURFACE-003`：PTY 普通问答、Skill、`/new`、取消、Approval、退出和资源清理；
- `CLOSE-SURFACE-004`：Windows ConPTY 实际通过；macOS ARM64/Linux x64 未运行时必须标记未验证；
- `CLOSE-SURFACE-005`：入口都使用同一 SessionFactory/Runtime 语义，不存在第二套 Agent Loop。

## P0：安全与隐私

- `CLOSE-SECURITY-001`：源码、测试、文档、dist、日志和评估产物无真实凭据和私人内容；
- `CLOSE-SECURITY-002`：Skill、网页、历史 Session 和模型回答不能改变权限、Sandbox、Approval、取消或 Tool 规则；
- `CLOSE-SECURITY-003`：Provider payload、Tool arguments、命令输出和路径按现有诊断策略脱敏/有界；
- `CLOSE-SECURITY-004`：发布包不包含 tests、fixture、PTY native addon 或本地评估资料。

## P1：真实评估

- `CLOSE-REAL-001`：仅使用用户授权的现有 Profile，记录脱敏轨迹，不重新发送无必要请求；
- `CLOSE-REAL-002`：Bailian/Qwen、DeepSeek、Local 的已实现能力分别记录通过、失败原因或未执行；
- `CLOSE-REAL-003`：真实评估失败按产品缺陷、Provider 账户/余额、网络/平台和测试环境分类；
- `CLOSE-REAL-004`：真实 Provider 评估不改变默认离线门禁。

## 完整门禁

```text
npm run typecheck
npm test
npm run build
npm run pack:check
npm audit
git diff --check
git status --short
```

P0 任一失败不得宣布 3.x 收口；P1 未执行可以收口，但必须保留原因、影响和重新评估条件。收口报告必须明确 Git 写操作和发布是否执行。

## 4.0 闸门

通过 3.9 门禁不等于自动进入 4.0。只有以下条件同时满足才建立 4.0 proposal：

1. 3.x stable 契约和兼容边界已经冻结；
2. P0 全部通过；
3. 至少一个新核心需求不能由现有窄接口安全实现；
4. 新需求的失败、取消、恢复、权限和测试边界已有初步设计；
5. 用户明确选择 4.0 主题和是否接受兼容性变化。

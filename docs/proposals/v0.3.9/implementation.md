# Isla v0.3.9 实施顺序

状态：Batch B-D 已实施；Batch E 的离线门禁已执行，发布与 Git 写操作未执行。

## Batch A：事实盘点

1. 读取 `AGENTS.md`、`docs/current/`、所有 v0.3.6-v0.3.8 proposal、roadmap、references 和 DSH review；
2. 列出源码实际入口、Provider、Tool、Session schema、CLI command、NDJSON request/event 和测试文件；
3. 标记文档与实现冲突，不直接猜测删除或改名；
4. 生成 3.x 能力/契约矩阵初稿。

停点：所有稳定声明都能指向源码和测试；所有未验证声明明确标记。

## Batch B：契约与兼容收口

1. 统一 current 文档入口为 3.x closeout 基线；
2. 固定 Session schema、Message source、Journal、Profile 和 Protocol 版本边界；
3. 为不能删除的历史格式写迁移/只读恢复规则；
4. 对 CLI、NDJSON、PTY 的命令和事件做等价性对照；
5. 对 Provider capability、模型白名单、streaming 回退和错误 code 做事实校验；
6. 不修改契约实现，除非测试证明当前行为互相矛盾。

停点：每个对外契约只有一个规范来源。

## Batch C：安全与隐私收口

1. 扫描 API Key、Token、真实 `.env`、完整模型回答、Skill 正文、Provider payload 和私人会话是否进入源码、日志、测试、dist 或文档；
2. 复核 Approval、Sandbox、read-before-edit、取消和完成门禁仍由 Runtime 强制；
3. 复核历史 Session、Skill source、Tool details 和诊断输出的敏感字段过滤；
4. 将发现的问题分为必须修复、文档澄清或明确接受风险。

停点：没有用“脱敏”掩盖事实源泄漏，也不因收口顺手增加未请求防护。

## Batch D：回归与真实评估收口

1. 运行 typecheck、全量离线测试、build、pack、audit 和 diff check；
2. 运行 CLI/NDJSON subprocess 与 PTY 基础矩阵；
3. 在用户授权和隔离 Profile 下复核已存在的 Bailian/DeepSeek 评估，不新增无必要真实请求；
4. 记录 Windows 已验证、macOS/Linux 未验证等平台事实；
5. 对失败按代码缺陷、环境问题、账户余额、平台未验证分类。

停点：测试结果、评估结果和文档数字一致。

## Batch E：3.x 关闭与 4.0 闸门

1. 更新 `README.md`、`docs/roadmap.md`、`docs/references.md`、`docs/dsh-reference-review.md` 和 `docs/current/`；
2. 把已结束 proposal 标为历史记录，保留决策和评估证据；
3. 生成 3.x closeout evaluation；
4. 检查 package 版本、发布意图和 Git 状态，未经用户明确要求不升级、不发布、不提交；
5. 根据 4.0 准入条件选择：进入 4.0 设计、继续补齐 3.9 未验证项、或暂停。

## 禁止越界

- 不借收口机会引入新 Runtime 抽象；
- 不删除历史文档或测试证据，只能迁移入口并标记历史；
- 不把 DSH 源码、包结构、Cordis 或事件总线引入项目；
- 不将“跨平台未验证”写成通过；
- 不执行 Git add、commit、push 或发布。

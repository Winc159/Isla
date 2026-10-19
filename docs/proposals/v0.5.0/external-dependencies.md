# v0.5.0 外部依赖策略

## 1. 统一入口

新环境使用：

```text
npm run install:deps
```

该命令目前会：

1. 安装与当前 Playwright npm 版本匹配的 Chromium；
2. 探测 `7zz`、`7z` 和 `unrar`；
3. 报告缺失的 Resource 工具；
4. 不自动执行 `sudo`、`apt`、`brew`、`winget` 或其他系统包管理器；
5. 不安装尚未锁定版本和命令契约的百度 runner。

`npm run install:deps -- --strict` 可作为部署门禁：任一必需依赖缺失就返回失败。普通模式保留诊断并继续，方便只使用 Isla 主对话的环境安装。

## 2. 外部 runner 的更新边界

外部命令可以独立于 Isla 更新，但必须由 Resource Service 在启动/健康检查时执行版本和能力探测。Isla 不应把外部命令的内部参数当作稳定 API。

每个外部 runner 应记录：

- 固定版本或 commit；
- 来源 URL 和校验摘要；
- Windows/Linux 安装路径；
- `--version` 输出；
- 支持的最小命令集合；
- 登录态、取消、进度和错误码能力；
- 升级后的兼容性验证结果。

runner 更新失败时保留旧版本，不应让 Isla 自动覆盖一个可用版本。更新应是独立的可回滚动作；Resource Job 只调用通过能力探测的 runner。

## 3. bdpan-storage 的当前决策

`bdpan-storage` 作为外部候选研究，不作为 Isla npm runtime dependency，也不把其 `latest` 发布或命令参数写入核心。正式采用前需要固定具体版本并验证 Windows/N100 Linux 的分享解析、文件枚举、下载、取消、进度和登录态行为。

Windows 实测补充：`bdpan 3.8.7` 禁止同一账号转存自己的分享（`errno=13045`）；这类任务应进入可解释失败或改用已确认的网盘内复制路径。下载到 Windows 时目标参数必须是明确文件路径，不能只传一个已存在目录。

已按 `baidu-drive` Skill 固定第一版适配边界：业务调用只允许 `whoami`、`ls`、`download`、`transfer`，统一追加 `--json`、`--agentname`、`--session-input` 和 `--session-id`；登录不由 Isla 代办，必须走 Skill 的 `login.sh`。对应适配器是 `src/resource/bdpan-runner.ts`，脚本入口为 `npm run resource:bdpan -- <command> ...`。

Skill 当前明确要求登录使用其 `login.sh`，禁止直接调用 `bdpan login`，并要求远端路径限制在 `/apps/bdpan/` 范围内；这些约束已进入适配器测试。来源：[baidu-drive Skill](https://raw.githubusercontent.com/baidu-netdisk/bdpan-storage/main/skills/baidu-drive/SKILL.md)。

如果其命令或发布形式变化，只更新 Resource runner 适配层和依赖安装 manifest，不修改 Job 状态机、SQLite、Web API 或主 Agent Runtime。

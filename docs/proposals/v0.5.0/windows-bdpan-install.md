# Windows bdpan 安装适配

官方 `install.sh` 依赖 Bash、curl/wget、sha256 工具和 Unix 路径，因此在 PowerShell 直接执行不成立。官方脚本同时提供 Windows x64 安装器；当前版本锁定为 `3.8.4`，并使用官方公布的 SHA256 校验值。

Windows 用户可以执行：

```powershell
npm run install:bdpan
```

从 Isla 统一安装入口执行：

```powershell
isla install
```

`npm run install:all` 会先探测通用依赖、安装 Windows 归档工具，再调用 Windows bdpan 适配器。普通 `isla` 启动不会自动更新任何外部工具；Linux/macOS 归档工具由系统包管理器负责。

如果明确需要强制重装：

```powershell
npm run install:bdpan -- --force
```

安装器默认保留官方确认流程。只有用户明确要求非交互安装时才使用：

```powershell
npm run install:bdpan -- --yes
```

脚本职责仅限：Windows x64 平台检查、下载官方固定版本、SHA256 校验、启动官方安装器和清理临时文件。它不登录、不读取 bdpan 配置、不设置 `BDPAN_*` 环境变量，也不把 token 写入 Isla。

版本升级必须同时更新脚本中的版本、下载地址和 SHA256，并重新进行 Windows/N100 Linux 验收；不会静默跟随 `latest`。

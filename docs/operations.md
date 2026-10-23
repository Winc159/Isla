# 运行与维护

## 日常使用

Resource 的处理链路、数据库表、任务 API 和故障排查见 [resource.md](./resource.md)。

## 首次安装与依赖检查

首次拉取项目后可以直接运行：

```bash
npm install
npm run install:all
npm run doctor
npm run build
```

`install:all` 会安装 Playwright Chromium，并在 Windows x64 上下载并校验 Isla 管理的 7-Zip；Windows 还会尝试安装 bdpan。Linux/macOS 不把 7-Zip 或 unrar 二进制打进 npm 包，而是使用系统包管理器提供的 `7zz/7z`，避免平台 ABI、许可证和包体积问题。`npm run doctor` 会在启动前检查必需和可选依赖。

```bash
isla                         # 连接常驻 Host，进入交互对话
isla 帮我总结今天的任务      # 恢复当前 workspace 最近会话，回答后退出
isla --new 开始一个新话题    # 创建新会话
isla --local                 # 显式使用进程内开发模式
```

## Linux / N100 常驻服务

```bash
isla service install
isla service status
isla service restart
isla service logs
```

Linux 首次交互运行 `isla` 完成配置向导后会自动安装服务。也可以显式运行 `isla service install`。安装过程使用当前 Node 可执行文件和 Isla 安装目录的绝对路径生成 systemd user units，并执行 `enable --now`。CLI 退出不会影响 Host、Resource 或后台任务。

若用户服务需要在未登录时启动，在目标 Linux 主机上执行：

```bash
loginctl enable-linger "$USER"
```

这项系统设置需要由用户在目标主机明确执行；Isla 不会自动修改 login linger。Host 和 Resource 只监听 loopback，远程管理 N100 时应使用 SSH，不应把内部端口直接暴露到公网。

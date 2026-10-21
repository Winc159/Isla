# 运行与维护

## 日常使用

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

# 配置

Isla 的正常配置事实源是 `~/.isla/config.json`。它保存主 Profile、可选 Worker Profile、Provider、模型、Base URL 和 API Key；`.env` 只用于显式的开发、CI 或迁移兼容启动。

`~/.isla/runtime.json` 由 Isla 自动生成，只保存 Resident Host 与 Resource 的 loopback 地址和随机进程间令牌。普通用户不需要编辑它。

`~/.isla/resource.json` 只保存受管资源目录。数据库、staging、并发、扫描周期和解压限制由 Resource 使用安全默认值派生。

Resource Bridge 在 Resource 健康且 Host 已连接时向主 Agent 提供受限 Job Tools。若当前 Profile 不需要 Agent 管理 Resource，可设置 `capabilities.resourceEnabled: false`；缺省值为启用。该开关不会影响 Resource Web 工具台。

API Key 是本地明文凭据，文件权限会尽量限制为当前用户。CLI 和 Resource Web 只显示“已配置/未配置”，不会回显密钥。配置更新使用 revision 检查和原子替换。

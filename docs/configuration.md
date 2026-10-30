# 配置

Isla 的正常配置事实源是 `~/.isla/config.json`。它保存主 Profile、可选 Worker Profile、Provider、模型、Base URL 和 API Key。普通 `dev`、`start` 与真实 Provider 测试都不会自动加载 `.env`；只有显式使用 `--env` 才会把环境变量作为配置来源。缺少 Config/Profile 时会报错，不会静默回退到环境变量。需要从 `.env` 启动时使用显式的 `dev:env` / `start:env` 脚本。

`~/.isla/runtime.json` 由 Isla 自动生成，只保存 Resident Host 与 Resource 的 loopback 地址和随机进程间令牌。普通用户不需要编辑它。

`~/.isla/resource.json` 只保存受管资源目录。数据库、staging、并发、扫描周期和解压限制由 Resource 使用安全默认值派生。

Resource Bridge 在 Resource 健康且 Host 已连接时向主 Agent 提供受限 Job Tools。若当前 Profile 不需要 Agent 管理 Resource，可设置 `capabilities.resourceEnabled: false`；缺省值为启用。该开关不会影响 Resource Web 工具台。

API Key 是本地明文凭据，文件权限会尽量限制为当前用户。CLI 和 Resource Web 只显示“已配置/未配置”，不会回显密钥。配置更新使用 revision 检查和原子替换。

MCP Streamable HTTP 的 OAuth 登录状态保存在 `~/.isla/mcp-oauth/`，按 MCP Server 与 endpoint 隔离，并尽量使用仅当前用户可读写的目录/文件权限；它不进入 Config/Profile、Session、诊断或日志。远程 MCP Server 需要在对应 Profile 的 `mcp.servers[].oauth.callbackBaseUrl` 配置指向此 Isla Host 的 HTTPS 回调基址（可包含反向代理路径前缀）；留空时使用本机 `127.0.0.1` loopback 回调，只适合本机浏览器。反向代理需保留 Host，并提供正确的 `X-Forwarded-Proto: https`。Host 授权发起仍受 Host bearer token 保护；公开回调只接受精确配置的 Host/协议与路径，并由官方 MCP SDK 校验 OAuth state、issuer 和 PKCE。登录过程中重启 Isla 会使尚未完成的临时授权失效，需要重新发起。

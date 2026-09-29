# v0.4.7：Headless Browser and Human Control Surface

状态：主体原型已实施；控制权一致性、跨平台可见窗口、Vault 填充和智能挑战处理按 Batch J 补齐

> Luna 执行入口：先阅读 [`luna-handoff.md`](./luna-handoff.md)，再按 [`implementation.md`](./implementation.md) 和 [`testing.md`](./testing.md) 分批执行。外部项目取舍见 [`research.md`](./research.md)。

## 新环境安装

Playwright npm 包与 Chromium 浏览器二进制是两个独立安装项。新环境拉取项目后只需执行：

```bash
npm run setup
```

该命令会依次完成 npm 依赖安装、Chromium 下载、构建和 `npm link`，完成后即可直接运行 `isla`。

如果只需要重试浏览器下载，执行 `npm run install:browser` 即可。下载失败不会损坏项目依赖，网络恢复后可重复执行。

## 目标

让 Linux 无头 Resident Host 启动并控制隔离的 Chromium，同时通过只监听 loopback 的 Browser Console 向用户展示当前页面、允许人工接管登录，并在模型、密码明文和网页之间建立严格边界。

首个完整闭环是：

```text
Isla 打开登录页
→ 用户通过 SSH 隧道访问 Browser Console
→ 用户首次手工登录并选择保存凭据
→ 后续 Agent 发现可用凭据并申请使用
→ 用户以 y/n/other 确认
→ Runtime 直接填入浏览器
→ Agent 只得到成功或失败状态，不得到密码
→ Agent 继续完成低风险网页任务
```

本地桌面默认允许用户从原生 Chromium 全程观察 Agent；Windows 与 macOS 使用可见窗口，Linux 有桌面时可选可见窗口。Linux 无桌面或远程部署使用 headless Chromium，通过 SSH 隧道访问 loopback Browser Console，不尝试用 iframe 嵌入第三方登录页面。

首次凭据输入由 Console 的账号/密码双栏安全表单直接交给 Runtime。模型只知道流程状态；登录成功后才询问是否保存。OTP、CAPTCHA、passkey 和设备确认会自动触发人工接管，且永不保存到 Vault。

## 范围

- Linux x64/ARM64 无头 Chromium 与显式安装检查。
- Browser Session 生命周期、页面观察和受控交互 Tool。
- `127.0.0.1` Browser Console，支持 SSH 本地端口转发。
- 周期截图、页面状态、人工接管、暂停、继续和关闭。
- 精确 Origin 绑定的本地加密密码簿。
- 首次手工输入、选择保存、按次 `y/n/other` 使用审批。
- 密码由 Runtime 注入，永不进入模型、Session、Tool Result、Journal 或普通日志。
- 导航、下载、上传、提交、发布、删除和支付的权限分级。

## 非目标

不开放公网监听、不做多用户、不读取用户日常 Chrome Profile、不破解验证码、不自动支付、不提供任意 JavaScript 执行、不把密码同步到云端、不建设浏览器扩展、不提供完整远程桌面或 noVNC，不承诺绕过网站反自动化策略。

文档入口：[设计](design.md) · [实施](implementation.md) · [测试](testing.md) · [验收](evaluation.md)

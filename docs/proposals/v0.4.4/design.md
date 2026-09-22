# v0.4.4 设计

## 1. 执行请求

```ts
interface CommandRequest {
  executable: string;
  argv: readonly string[];
  cwd: 'workspace' | string;
  timeoutMs: number;
}
```

模型不能传 shell 拼接字符串、重定向或控制符；需要 shell 语法必须由显式宿主 Tool 定义并单独评审。

## 2. 策略

- readonly：只允许已分类的只读命令，且不得写 workspace。
- workspace-write：允许写 workspace，始终 Approval。
- full：仍受危险命令硬拒绝和显式 Approval，不等于无约束。

策略判断使用解析后的 executable/argv/cwd，不扫描显示字符串。命令分类未知时默认 ask 或 deny。

## 3. 资源边界

显式最小 env；cwd 必须解析并校验；stdout/stderr 分离、有界；timeout/取消终止整个进程树；唯一终态；结果进入模型前规范化。

## 4. 执行世界

首版只定义窄 `CommandExecutor` seam，使本地 Adapter 可在未来替换为容器或远程主机；不建立通用 sandbox/plugin framework。

## 5. 偏离条件

若需要持久进程、后台 Job、终端复用、远程执行或权限提升，停止并单独设计。
